// LoaderIsoView — the iso authoring viewport rendered by the NATIVE world_loader
// instead of a React Scene3D rebuild (LOADERVIEW req_1757/req_1769), now with native
// MAP EDITING (req_1792/req_1793).
//
// Why this exists: booting the editor's iso pane through React's 3D path serialized
// ~683MB of mesh/instance/texture data across the host bridge every time (measured —
// the "I MADE IT" probe), which made the big 'main' map take ~30s and render blank. The
// compiled game loads the SAME static world from a gamefile in one native read. This
// pane mounts that loader inline (<WorldLoader>) and drives its camera from the editor's
// IsoStage — boot dropped to ~3s and the world renders.
//
// Camera: JS owns the solve. We push IsoStage.solve()'s eye+look+fov to the loader via
// __compiled_world_set_camera each frame; the host snaps to it (world_loader.zig
// setExternalCamera). It's the SAME GAME_CAMERA.solve(Isometric) pose IsoAuthor uses, so
// picking matches the render by construction. Controls mirror IsoAuthor: drag rotates,
// WASD/arrows pan (stage.nudge), wheel zooms.
//
// EDITING (req_1792): the heavy lifting is renderer-agnostic and lives in GAME_BUILD
// (raycast/placementFor/validatePlacement/connected) + IsoStage (pieceRay/groundPoint/
// project) — the SAME primitives IsoAuthor authors with. This pane is a second thin
// consumer: it arms a catalog piece via the SAME <CatalogRail>, resolves the cursor with
// the SAME resolveSnapTarget, and commits the SAME piecePlaced/buildingMoved events to
// the SAME world stream. The auto-compile (index.tsx) re-bakes ~2.5s after an edit and
// the loader reloads in place, so a placed piece appears in the native render shortly
// after. Visual feedback (ghost + selection) is a 2D PROJECTED HUD over the loader
// (the meshSelect.tsx pattern: <Graph.Polyline> in an identity view, pointerEvents off)
// — NOT a second React Scene3D surface. Re-introducing that surface is the 683MB path
// this whole pane exists to kill; the line is host-side or 2D-projected only.

import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Graph, Pressable, Text } from '@reactjit/primitives';
import { useRerender } from '@reactjit/runtime/hooks';
import { busOn } from '@reactjit/hooks/useIFTTT';
import { IsoStage, METERS_PER_LEVEL } from './isoStage';
import { editorTypingFocused } from './editors/controls';
import { GAME_BUILD, buildingPieceInstanceId, partitionBuildingSelection } from './game';
import type { BuildEditEvent, BuildPrefabDef, BuildingInstance, PlacedBuildPiece, Rect, WorldGridState } from './game';
import { modulePitch, resolveSnapTarget, SNAP_TUNING_DEFAULTS, type SnapTarget } from './editors/build/snap';
import { CatalogRail, sameArmed, type Armed } from './IsoAuthor';
import { pieceInstanceRows, meshPropLivePush, meshGhostRef, pieceSkinSig, buildingSkinBoxes } from './editors/build/pieceMeshes';
import { groundColumnTop } from './Embodied';
import type { GameState } from './design';

const g: any = globalThis;
const DEG = Math.PI / 180;

const DEFAULT_GAME_FILE = 'zig-out/game/hmsc.gamefile';
const DEFAULT_STORE_DIR = 'zig-out/game/contentstore';

// The iso eye sits 90–257m out, far past F2's crosshair reach — the same reach the React
// pane snaps with (IsoAuthor ISO_SNAP_TUNING) so a click lands identically in both panes.
const ISO_SNAP_TUNING = { ...SNAP_TUNING_DEFAULTS, reachMeters: 600, groundMarchStepMeters: 0.5 };

// key → pan axis. Arrows alias WASD, matching the iso-build legend.
const PAN_KEYS: Record<string, string> = {
  w: 'w', a: 'a', s: 's', d: 'd',
  arrowup: 'w', arrowleft: 'a', arrowdown: 's', arrowright: 'd',
};

// Project a world-space AABB / oriented box to pane pixels and emit its 12 wireframe
// edges as Graph.Polyline `segments` pairs (x0,y0,x1,y1,…). Yaw rotates the footprint
// about Y; a selection box passes yaw 0 (its bounds are already world-axis-aligned). A
// corner behind the eye projects to null and its edges are dropped — the box still reads.
function boxSegments(
  stage: IsoStage, rect: Rect,
  cx: number, baseY: number, cz: number, yawDeg: number,
  w: number, h: number, d: number,
): number[] {
  const c = Math.cos(yawDeg * DEG), s = Math.sin(yawDeg * DEG);
  const hw = w / 2, hd = d / 2;
  const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, lz]) => ({
    x: cx + lx * c - lz * s,
    z: cz + lx * s + lz * c,
  }));
  const bot = corners.map((q) => stage.project(q.x, baseY, q.z, rect));
  const top = corners.map((q) => stage.project(q.x, baseY + h, q.z, rect));
  const segs: number[] = [];
  const edge = (a: { x: number; y: number } | null, b: { x: number; y: number } | null) => {
    if (a && b) segs.push(a.x, a.y, b.x, b.y);
  };
  for (let i = 0; i < 4; i += 1) {
    edge(bot[i], bot[(i + 1) % 4]);
    edge(top[i], top[(i + 1) % 4]);
    edge(bot[i], top[i]);
  }
  return segs;
}

export function LoaderIsoView(props: {
  gameFile?: string;
  storeDir?: string;
  centerX?: number;
  centerZ?: number;
  reloadToken?: number; // bump to reload the gamefile in place (after a re-bake)
  // ── editing (req_1792): the SAME inputs index.tsx feeds IsoAuthor ──────────────
  state?: GameState;                                  // world under the pieces (terrain sampler)
  pieces?: readonly PlacedBuildPiece[];               // the standing pieces (pick/select/move target)
  buildings?: Readonly<Record<string, BuildingInstance>>; // instance refs (whole-building moves/deletes)
  prefabs?: readonly BuildPrefabDef[];                // the rail's prefab list (built-in + stream)
  onCommit?: (event: BuildEditEvent, label: string) => void;
  onCommitMany?: (items: ReadonlyArray<{ event: BuildEditEvent; label: string }>) => void;
  onSelectionChange?: (ids: ReadonlySet<string>) => void;
  onPlaceWaterBody?: (presetKind: string, x: number, z: number) => void;
  // LIVEHOST tier-2 (req_1800): a debounced "settle" bake the pane requests ONLY when an
  // edit removed/relocated a BAKED piece — the live overlay can add meshes but can't erase
  // a baked one, so a delete/move/rotate of pre-baked geometry needs a bake to reflect.
  // Pure placements never call this (the overlay shows them instantly).
  requestSettleBake?: () => void;
}) {
  const gameFile = props.gameFile ?? DEFAULT_GAME_FILE;
  const storeDir = props.storeDir ?? DEFAULT_STORE_DIR;
  const editable = !!props.onCommit; // no commit door → a pure viewer (no rail/editing)

  const loaderRef = useRef<any>(null);
  const rectRef = useRef<Rect>({ x: 0, y: 0, width: 1, height: 1 });
  const rerender = useRerender();
  const rerenderRef = useRef(rerender);
  rerenderRef.current = rerender;

  // ── live refs (the Pressable stale-closure discipline) ─────────────────────────
  const piecesRef = useRef(props.pieces ?? []);
  piecesRef.current = props.pieces ?? [];
  const buildingsRef = useRef(props.buildings);
  buildingsRef.current = props.buildings;
  const onCommitRef = useRef(props.onCommit);
  onCommitRef.current = props.onCommit;
  const onCommitManyRef = useRef(props.onCommitMany);
  onCommitManyRef.current = props.onCommitMany;
  const commitMany = useCallback((items: ReadonlyArray<{ event: BuildEditEvent; label: string }>) => {
    if (!items.length) return;
    if (onCommitManyRef.current) onCommitManyRef.current(items);
    else for (const it of items) onCommitRef.current?.(it.event, it.label);
  }, []);

  const prefabs = props.prefabs ?? GAME_BUILD.prefabs.ids.map((id) => GAME_BUILD.prefabs.get(id));
  const prefabById = useMemo(() => new Map(prefabs.map((d) => [d.id, d])), [prefabs]);
  const prefabByIdRef = useRef(prefabById);
  prefabByIdRef.current = prefabById;

  // ── terrain sampler: the SAME groundColumnTop F2/IsoAuthor snap against, so a
  // level-0 placement drapes over painted hills identically. Keyed on the world
  // FIELDS so a state-identity tick (physics/HUD) doesn't churn the sampler.
  const worldGrid = useMemo<WorldGridState | null>(() => {
    if (!props.state) return null;
    const wld = props.state.world;
    return {
      cellSizeMeters: wld.cellSizeMeters,
      surfaceRegions: wld.surfaceRegions as unknown as WorldGridState['surfaceRegions'],
      placedCells: wld.placedCells as unknown as WorldGridState['placedCells'],
      landforms: (wld.landforms ?? []) as unknown as WorldGridState['landforms'],
    };
  }, [props.state?.world.cellSizeMeters, props.state?.world.surfaceRegions, props.state?.world.placedCells, props.state?.world.landforms]);
  const groundTopAt = useCallback((x: number, z: number): number => (
    worldGrid ? groundColumnTop(worldGrid, x, z) : 0
  ), [worldGrid]);

  // ── editing state ──────────────────────────────────────────────────────────────
  const [armed, setArmed] = useState<Armed>(null);
  const armedRef = useRef<Armed>(armed);
  armedRef.current = armed;
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const [ghostYaw, setGhostYaw] = useState(0);
  const ghostYawRef = useRef(ghostYaw);
  ghostYawRef.current = ghostYaw;
  // FLOORLEVELS req_1857: the active build storey. The stage owns the level offset (its
  // camera target + pick plane rise with it, placeGroundAt lands pieces on the slab); this
  // mirror drives the HUD indicator + re-renders when you change floors.
  const [level, setLevelState] = useState(0);
  const [snap, setSnap] = useState<SnapTarget | null>(null);
  const [moveDelta, setMoveDelta] = useState<{ dx: number; dz: number } | null>(null);
  const moveDeltaRef = useRef(moveDelta);
  moveDeltaRef.current = moveDelta;
  // Drag-paint preview (req_1801): the cells an armed wall/floor would lay along the
  // current drag — drawn as a green ghost run, committed as ONE batch on release.
  type PaintCell = { pieceId: string; x: number; y: number; z: number; yawDegrees: number };
  const [paintCells, setPaintCells] = useState<PaintCell[] | null>(null);
  const paintCellsRef = useRef(paintCells);
  paintCellsRef.current = paintCells;
  const modRef = useRef({ shift: false, alt: false, ctrl: false });
  // Last cursor in pane pixels — so R (rotate ghost) re-resolves the preview IN PLACE
  // instead of waiting for the next mouse-move.
  const lastCursorRef = useRef<{ x: number; y: number } | null>(null);
  // The hover-ghost cell key — the per-frame poll only re-snaps when the target CELL
  // changes, so the ghost doesn't thrash a re-render every frame.
  const ghostKeyRef = useRef('');
  // The piece ids the NATIVE loader is currently showing (the last baked set). The loader
  // renders the baked gamefile, which lags edits by a bake, so any piece committed since
  // then is "pending" — drawn as an instant 2D box (req_1797) until the next reload swaps
  // in the real mesh. Seeded with the boot set; refreshed each reload.
  const bakedIdsRef = useRef<Set<string> | null>(null);
  if (bakedIdsRef.current === null) bakedIdsRef.current = new Set((props.pieces ?? []).map((p) => p.id));
  // RESKIN req_1845: the SKIN each baked prop wore at bake time, so a prop re-skinned since
  // is detected and rendered live (with its new skin) while its stale baked copy is hidden.
  const bakedSigRef = useRef<Map<string, string> | null>(null);
  if (bakedSigRef.current === null) bakedSigRef.current = new Map((props.pieces ?? []).map((p) => [p.id, pieceSkinSig(p)] as const));

  // Mirror the selection up so the cart's PropertiesPanel/FacePainter light up — the
  // SAME onSelectionChange contract IsoAuthor reports through.
  const onSelectionChangeRef = useRef(props.onSelectionChange);
  onSelectionChangeRef.current = props.onSelectionChange;
  useEffect(() => { onSelectionChangeRef.current?.(selectedIds); }, [selectedIds]);

  const stageRef = useRef<IsoStage | null>(null);
  if (!stageRef.current) {
    stageRef.current = new IsoStage(
      { centerX: props.centerX ?? 0, centerZ: props.centerZ ?? 0, zoom: 1, level: 0 },
      () => 0,
    );
  }
  const stage = stageRef.current;
  // Keep the stage's height sampler current as the painted world changes.
  useEffect(() => { stage.setHeightSampler(groundTopAt); }, [stage, groundTopAt]);

  // The Y a placement's base sits at on the active floor: terrain at level 0, a flat
  // slab above — the SAME placeGroundAt rule IsoAuthor uses.
  const placeGroundAt = useCallback((x: number, z: number): number => {
    const lvl = stage.pose.level;
    return lvl > 0 ? lvl * METERS_PER_LEVEL : groundTopAt(x, z);
  }, [stage, groundTopAt]);

  // Push the JS-solved iso pose to the native loader's camera. Cheap (8 floats) — the
  // ONLY per-frame bridge traffic, vs the ~683MB the React scene shipped. While
  // something is on the HUD (armed ghost / selection), also redraw the 2D overlay so it
  // tracks the camera (the projection is JS, the loader can't move it for us).
  const pushCamera = useCallback((): boolean => {
    const nodeId = Number(loaderRef.current?.id ?? 0);
    const ok = nodeId > 0 && typeof g.__compiled_world_set_camera === 'function';
    if (ok) {
      const s: any = stage.solve();
      g.__compiled_world_set_camera(
        nodeId,
        s.pos[0], s.pos[1], s.pos[2],
        s.target[0], s.target[1], s.target[2],
        s.fov,
      );
    }
    // Redraw the 2D HUD ONLY when it has something to track (a ghost, a selection, or a
    // paint preview). req_1806: an unconditional React re-render per camera frame
    // reconciled the whole pane on every drag/pan tick, throttling the editor frame loop
    // the loader renders embedded in — so plain navigation went choppy while the same
    // loader is butter-smooth in the standalone game. Pure navigation now just pushes the
    // 8-float pose (cheap, no React); the host re-applies it each renderEmbedded frame.
    if (armedRef.current || selectedIdsRef.current.size || paintCellsRef.current) rerenderRef.current();
    return ok;
  }, [stage]);

  // ── snap resolution: the cursor → a placement, with the SAME inputs F2/IsoAuthor use.
  const resolveAt = useCallback((sx: number, sy: number): SnapTarget | null => {
    const a = armedRef.current;
    if (!a || a.kind === 'tower') return null; // tower drag-shell tool deferred
    const pieceDef = a.kind === 'piece' ? GAME_BUILD.catalog.get(a.id) : null;
    const armedPrefabDef = a.kind === 'prefab' ? prefabByIdRef.current.get(a.id) : undefined;
    const prefabAnchor = armedPrefabDef ? GAME_BUILD.prefabs.gridAnchor(armedPrefabDef) : null;
    const snapMode = pieceDef ? pieceDef.snap : 'grid';
    const size = pieceDef
      ? pieceDef.size
      : prefabAnchor
        ? prefabAnchor.size
        : { widthMeters: 1, heightMeters: 3, depthMeters: 1 };
    return resolveSnapTarget({
      ray: stage.pieceRay(sx, sy, rectRef.current),
      pieces: piecesRef.current,
      groundTopAt: placeGroundAt,
      snap: snapMode,
      size,
      yawDegrees: ghostYawRef.current,
      freeform: modRef.current.alt,
      subgrid: modRef.current.shift,
      ...(prefabAnchor ? { anchorLocal: { x: prefabAnchor.x, z: prefabAnchor.z } } : {}),
      tuning: ISO_SNAP_TUNING,
    });
  }, [stage, placeGroundAt]);
  // The per-frame hover poll reads the latest resolveAt through a ref, so the pan loop
  // (which subscribes once) never snaps against a stale terrain/world.
  const resolveAtRef = useRef(resolveAt);
  resolveAtRef.current = resolveAt;

  // FLOORLEVELS req_1857: go up/down a storey. The stage clamps at the ground (level 0);
  // raising lifts the camera target + the pick plane so placements land ON that floor's slab
  // (placeGroundAt). Mirror the level into state (HUD), push the new camera, and re-resolve
  // the armed ghost in place so the preview jumps to the new floor immediately.
  const changeLevel = useCallback((delta: number) => {
    stage.setLevel(stage.pose.level + delta);
    setLevelState(stage.pose.level);
    pushCamera();
    const c = lastCursorRef.current;
    if (armedRef.current && c) setSnap(resolveAtRef.current(c.x, c.y));
  }, [stage, pushCamera]);

  // ── commit: place the armed thing at a resolved snap target ──────────────────────
  const placeAt = useCallback((t: SnapTarget) => {
    const a = armedRef.current;
    if (!a) return;
    if (selectedIdsRef.current.size) setSelectedIds(new Set());
    const at = `${t.placement.x.toFixed(1)},${t.placement.z.toFixed(1)}`;
    if (a.kind === 'tower') return; // deferred
    if (a.kind === 'prefab') {
      const def = prefabByIdRef.current.get(a.id);
      if (!def) return;
      onCommitRef.current?.({ kind: 'prefabStamped', prefabId: a.id, origin: { x: t.placement.x, y: t.placement.y, z: t.placement.z }, yawDegrees: t.placement.yawDegrees }, `stamped ${def.label} @ ${at}`);
      return;
    }
    if (a.kind === 'water') {
      props.onPlaceWaterBody?.(a.id, t.placement.x, t.placement.z);
      return;
    }
    const def = GAME_BUILD.catalog.get(a.id);
    const placement = GAME_BUILD.placed.placementFor(def, t.placement);
    if (GAME_BUILD.placed.validatePlacement(placement).length > 0) return;
    onCommitRef.current?.({ kind: 'piecePlaced', placement }, `placed ${def.label} @ ${at}`);
  }, [props.onPlaceWaterBody]);

  // ── select: raycast the standing pieces. `whole` (double-click) selects the
  // connected object; otherwise the single hit piece. Empty space clears.
  const selectPieceAt = useCallback((sx: number, sy: number, whole: boolean) => {
    const hit = GAME_BUILD.placed.raycast(stage.pieceRay(sx, sy, rectRef.current), piecesRef.current, ISO_SNAP_TUNING.reachMeters);
    if (!hit) { setSelectedIds(new Set()); return; }
    setSelectedIds(whole ? GAME_BUILD.placed.connected(hit.piece.id, piecesRef.current) : new Set([hit.piece.id]));
  }, [stage]);

  // ── multi-select (Ctrl-click): toggle the hit piece in/out of the running
  // selection instead of replacing it. Ctrl-click on empty space keeps the
  // selection (a missed click shouldn't wipe a multi-select in progress).
  const togglePieceAt = useCallback((sx: number, sy: number) => {
    const hit = GAME_BUILD.placed.raycast(stage.pieceRay(sx, sy, rectRef.current), piecesRef.current, ISO_SNAP_TUNING.reachMeters);
    if (!hit) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(hit.piece.id)) next.delete(hit.piece.id);
      else next.add(hit.piece.id);
      return next;
    });
  }, [stage]);

  // ── delete: pieceRemoved per loose piece, buildingRemoved per whole instance ─────
  const deleteSelected = useCallback(() => {
    const ids = selectedIdsRef.current;
    if (!ids.size) return;
    const { wholeInstances, partialInstances, loosePieceIds } = partitionBuildingSelection(ids, piecesRef.current);
    if (partialInstances.length) console.warn(`[loader-iso] delete skipped ${partialInstances.length} partially-selected building(s) — shift-click the whole building`);
    const events: Array<{ event: BuildEditEvent; label: string }> = [
      ...wholeInstances.map((id) => ({ event: { kind: 'buildingRemoved', id } as BuildEditEvent, label: `removed building ${id}` })),
      ...loosePieceIds.map((id) => ({ event: { kind: 'pieceRemoved', id } as BuildEditEvent, label: `removed ${id}` })),
    ];
    if (!events.length) return;
    commitMany(events);
    setSelectedIds(new Set());
  }, [commitMany]);

  // ── move: commit the snapped XZ delta — buildingMoved for whole instances, a
  // remove+place per loose piece (the SAME shape IsoAuthor's commitMove uses).
  const commitMove = useCallback(() => {
    const delta = moveDeltaRef.current;
    setMoveDelta(null);
    if (!delta || (Math.abs(delta.dx) < 1e-3 && Math.abs(delta.dz) < 1e-3)) return;
    const ids = selectedIdsRef.current;
    const sel = piecesRef.current.filter((p) => ids.has(p.id));
    if (!sel.length) return;
    const { wholeInstances, partialInstances, loosePieceIds } = partitionBuildingSelection(ids, piecesRef.current);
    if (partialInstances.length) { console.warn(`[loader-iso] move aborted — ${partialInstances.length} building(s) partially selected`); return; }
    const events: Array<{ event: BuildEditEvent; label: string }> = [];
    for (const instId of wholeInstances) {
      const inst = buildingsRef.current?.[instId];
      if (!inst) return; // instance vanished under us — abort the whole move
      events.push({ event: { kind: 'buildingMoved', id: instId, x: inst.x + delta.dx, z: inst.z + delta.dz } as BuildEditEvent, label: `moved building ${instId}` });
    }
    const looseSet = new Set(loosePieceIds);
    const moves = sel.filter((p) => looseSet.has(p.id)).map((p) => {
      const { id, ...rest } = p;
      return { id, placement: { ...rest, x: p.x + delta.dx, z: p.z + delta.dz } };
    });
    if (moves.some((m) => GAME_BUILD.placed.validatePlacement(m.placement).length > 0)) return;
    commitMany([
      ...events,
      ...moves.map((m) => ({ event: { kind: 'pieceRemoved', id: m.id } as BuildEditEvent, label: `moved ${m.id}` })),
      ...moves.map((m) => ({ event: { kind: 'piecePlaced', placement: m.placement } as BuildEditEvent, label: `moved ${m.placement.pieceId}` })),
    ]);
    setSelectedIds(new Set());
  }, [commitMany]);

  // ── rotate the selection 90° (R with a selection) — whole buildings as ONE
  // buildingMoved+yaw, loose pieces via remove+place (the SAME shape IsoAuthor's
  // rotateSelected uses). Selection clears after (no reselect-by-signature here);
  // R with nothing selected turns the placement ghost instead (handled in the key bus).
  const rotateSelected = useCallback(() => {
    const ids = selectedIdsRef.current;
    if (!ids.size) return;
    const sel = piecesRef.current.filter((p) => ids.has(p.id));
    if (!sel.length) return;
    const { wholeInstances, partialInstances, loosePieceIds } = partitionBuildingSelection(ids, piecesRef.current);
    if (partialInstances.length) { console.warn(`[loader-iso] rotate skipped ${partialInstances.length} partially-selected building(s)`); return; }
    const norm = (y: number) => ((y % 360) + 360) % 360;
    const events: Array<{ event: BuildEditEvent; label: string }> = [];
    for (const instId of wholeInstances) {
      const inst = buildingsRef.current?.[instId];
      if (!inst) continue;
      events.push({ event: { kind: 'buildingMoved', id: instId, x: inst.x, z: inst.z, yawDegrees: norm(inst.yawDegrees + 90) } as BuildEditEvent, label: `rotated building ${instId}` });
    }
    const looseSet = new Set(loosePieceIds);
    const rotations = sel.filter((p) => looseSet.has(p.id)).map((p) => {
      const { id, ...rest } = p;
      return { id, placement: { ...rest, yawDegrees: norm(p.yawDegrees + 90) } };
    });
    if (rotations.some((r) => GAME_BUILD.placed.validatePlacement(r.placement).length > 0)) return;
    events.push(
      ...rotations.map((r) => ({ event: { kind: 'pieceRemoved', id: r.id } as BuildEditEvent, label: `rotated ${r.id}` })),
      ...rotations.map((r) => ({ event: { kind: 'piecePlaced', placement: r.placement } as BuildEditEvent, label: `rotated ${r.placement.pieceId}` })),
    );
    if (!events.length) return;
    commitMany(events);
    setSelectedIds(new Set());
  }, [commitMany]);

  // ── clone (req_1801): duplicate the selection shifted clear along +x by its own width
  // — whole buildings as ONE buildingPlaced of the same def (its own instance/history),
  // loose pieces re-emit piecePlaced (fresh stream ids). A pure ADD, so the live overlay
  // shows the copies instantly with no settle bake. Same shape as IsoAuthor's cloneSelected.
  const cloneSelected = useCallback(() => {
    const ids = selectedIdsRef.current;
    const sel = piecesRef.current.filter((p) => ids.has(p.id));
    if (!sel.length) return;
    let minX = Infinity, maxX = -Infinity;
    for (const p of sel) { const b = GAME_BUILD.placed.bounds(p); minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX); }
    const dx = (maxX - minX) + (props.state?.world.cellSizeMeters ?? 1);
    const { wholeInstances } = partitionBuildingSelection(ids, piecesRef.current);
    const whole = new Set(wholeInstances);
    const events: Array<{ event: BuildEditEvent; label: string }> = [];
    for (const instId of wholeInstances) {
      const inst = buildingsRef.current?.[instId];
      if (!inst) continue;
      events.push({ event: { kind: 'buildingPlaced', defId: inst.defId, x: inst.x + dx, y: inst.y, z: inst.z, yawDegrees: inst.yawDegrees } as BuildEditEvent, label: `cloned building ${instId}` });
    }
    const cloneStampId = `clone-${Date.now().toString(36)}`;
    for (const p of sel) {
      const inst = buildingPieceInstanceId(p.id);
      if (inst && whole.has(inst)) continue; // cloned above as one instance
      const { id, ...rest } = p;
      events.push({ event: { kind: 'piecePlaced', placement: { ...rest, x: p.x + dx, stampId: cloneStampId } } as BuildEditEvent, label: `cloned ${p.pieceId}` });
    }
    if (!events.length) return;
    commitMany(events);
  }, [commitMany, props.state]);

  // ── drag-paint (req_1801): an armed WALL drags a straight run along the dominant axis;
  // an armed FLOOR fills the dragged rectangle. World-lattice cells at the module pitch,
  // one flat base y under the centroid — the SAME cell math IsoAuthor's computePaint uses
  // (minus the existing-geometry anchoring, a later refinement). Committed as ONE batch.
  const PAINT_MAX_SPAN = 64;
  const paintKindOf = useCallback((a: Armed): 'wall' | 'floor' | null => {
    if (!a || a.kind !== 'piece') return null;
    const k = GAME_BUILD.catalog.get(a.id).kind;
    return k === 'wall' || k === 'floor' ? k : null;
  }, []);
  const computePaintCells = useCallback((a: Armed, start: { x: number; z: number }, end: { x: number; z: number }): PaintCell[] => {
    const kind = paintKindOf(a);
    if (!kind || !a || a.kind !== 'piece') return [];
    const def = GAME_BUILD.catalog.get(a.id);
    const pitch = modulePitch(def.size.widthMeters, 1);
    const cellOf = (v: number) => Math.floor(v / pitch);
    const center = (c: number) => (c + 0.5) * pitch;
    const range = (a0: number, b0: number): [number, number] => { const lo = Math.min(a0, b0), hi = Math.max(a0, b0); return [lo, Math.min(hi, lo + PAINT_MAX_SPAN - 1)]; };
    const cells: { x: number; z: number; yaw: number }[] = [];
    if (kind === 'floor') {
      const [x0, x1] = range(cellOf(start.x), cellOf(end.x));
      const [z0, z1] = range(cellOf(start.z), cellOf(end.z));
      for (let cx = x0; cx <= x1; cx += 1) for (let cz = z0; cz <= z1; cz += 1) cells.push({ x: center(cx), z: center(cz), yaw: 0 });
    } else {
      const dx = Math.abs(end.x - start.x), dz = Math.abs(end.z - start.z);
      if (dx >= dz) {
        const lineZ = Math.round(start.z / pitch) * pitch;
        const [c0, c1] = range(cellOf(start.x), cellOf(end.x));
        for (let c = c0; c <= c1; c += 1) cells.push({ x: center(c), z: lineZ, yaw: 0 });
      } else {
        const lineX = Math.round(start.x / pitch) * pitch;
        const [c0, c1] = range(cellOf(start.z), cellOf(end.z));
        for (let c = c0; c <= c1; c += 1) cells.push({ x: lineX, z: center(c), yaw: 90 });
      }
    }
    if (!cells.length) return [];
    let sx = 0, sz = 0;
    for (const c of cells) { sx += c.x; sz += c.z; }
    const y = placeGroundAt(sx / cells.length, sz / cells.length);
    return cells.map((c) => ({ pieceId: def.id, x: c.x, y, z: c.z, yawDegrees: c.yaw }));
  }, [paintKindOf, placeGroundAt]);
  const computePaintCellsRef = useRef(computePaintCells);
  computePaintCellsRef.current = computePaintCells;
  const commitPaint = useCallback(() => {
    const cells = paintCellsRef.current;
    setPaintCells(null);
    if (!cells || !cells.length) return;
    const valid = cells.filter((c) => GAME_BUILD.placed.validatePlacement(c).length === 0);
    if (!valid.length) return;
    if (selectedIdsRef.current.size) setSelectedIds(new Set());
    commitMany(valid.map((c) => {
      const placement = GAME_BUILD.placed.placementFor(GAME_BUILD.catalog.get(c.pieceId), c);
      return { event: { kind: 'piecePlaced', placement } as BuildEditEvent, label: `painted ${c.pieceId}` };
    }));
  }, [commitMany]);

  // ── keys: WASD/arrows pan, Q/E orbit, F recenter (camera) + R rotate ghost, Del
  // delete, Esc disarm/clear (editing). Direct key-bus subscription (req_1777): the
  // editor control contract swallowed WASD here; the raw bus is the host's own source.
  const heldPanRef = useRef<Record<string, boolean>>({});
  useEffect(() => {
    const onKey = (down: boolean) => (e: any) => {
      const k = String(e?.key ?? '').toLowerCase();
      if (k === 'shift') modRef.current.shift = down;
      else if (k === 'alt') modRef.current.alt = down;
      else if (k === 'control') modRef.current.ctrl = down;
      const axis = PAN_KEYS[k];
      if (axis) {
        if (down && editorTypingFocused()) return; // let the focused field have the key
        heldPanRef.current[axis] = down;
        return;
      }
      if (!down || editorTypingFocused()) return;
      if (k === 'q') { stage.rotate(-1); pushCamera(); }
      else if (k === 'e') { stage.rotate(1); pushCamera(); }
      else if (k === 'f' || k === 'home') { stage.centerOn(props.centerX ?? 0, props.centerZ ?? 0); pushCamera(); }
      else if (editable && k === 'r') {
        // R turns the SELECTION if one exists, else the placement ghost (the IsoAuthor rule).
        if (selectedIdsRef.current.size) rotateSelected();
        else setGhostYaw((y) => (y + 90) % 360);
      }
      else if (editable && (k === 'delete' || k === 'backspace')) { deleteSelected(); }
      else if (editable && k === 'c' && selectedIdsRef.current.size) { cloneSelected(); }
      // FLOORLEVELS req_1857: ] / PageUp go up a storey, [ / PageDown go down.
      else if (editable && (k === ']' || k === 'pageup')) { changeLevel(1); }
      else if (editable && (k === '[' || k === 'pagedown')) { changeLevel(-1); }
      else if (editable && k === 'escape') {
        if (armedRef.current) setArmed(null);
        else setSelectedIds(new Set());
      }
    };
    const offDown = busOn('__keydown', onKey(true));
    const offUp = busOn('__keyup', onKey(false));
    return () => { offDown(); offUp(); heldPanRef.current = {}; modRef.current = { shift: false, alt: false, ctrl: false }; };
  }, [stage, pushCamera, props.centerX, props.centerZ, editable, deleteSelected, rotateSelected, cloneSelected, changeLevel]);

  // Re-resolve the hover ghost after R turns it, so the preview spins in place at the
  // last known cursor instead of waiting for the next mouse-move.
  useEffect(() => {
    const lc = lastCursorRef.current;
    if (armedRef.current && lc) setSnap(resolveAt(lc.x, lc.y));
  }, [ghostYaw, resolveAt]);

  // The held-key pan loop (rAF, or a setTimeout FALLBACK when rAF isn't a host global —
  // req_1777). Push the camera ONLY when the pose actually moves (req_1790/1791: idle
  // per-frame pushes "lag like shit"); the host re-applies the last pose itself.
  useEffect(() => {
    const sched: (fn: () => void) => any = g.requestAnimationFrame
      ? g.requestAnimationFrame.bind(g)
      : (fn: () => void) => setTimeout(fn, 16);
    let alive = true;
    let last = g.performance?.now?.() ?? 0;
    // REMOUNT FIX (req_1879): the loader node id may not be ready the instant this effect
    // runs (the host mounts lazily), and on a SETTLED remount — e.g. dashboard → /editor,
    // where pieces/stage don't change — nothing else re-triggers a push. So a single
    // mount-time push can miss and the loader falls back to its default player-trailing
    // GAME camera. Keep pushing each frame until the iso pose actually lands, THEN stop
    // (req_1790: no idle per-frame pushes once established).
    let camEstablished = pushCamera();
    const tick = () => {
      if (!alive) return;
      if (!camEstablished) camEstablished = pushCamera();
      const now = g.performance?.now?.() ?? last + 16;
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      const held = heldPanRef.current;
      const forward = (held.w ? 1 : 0) - (held.s ? 1 : 0);
      const strafe = (held.d ? 1 : 0) - (held.a ? 1 : 0);
      if (forward || strafe) {
        const speed = Math.max(18, stage.distance() * 0.85);
        stage.nudge(forward * speed * dt, strafe * speed * dt);
        pushCamera();
      }
      // Hover ghost (req_1796): the host fires NO passive move events — onMouseMove only
      // arrives during a drag — so the armed preview must follow the cursor by polling
      // getMouseX/Y here, the SAME way IsoAuthor's loop does. Only when the cursor is over
      // this pane, not during a move-drag, and only re-snap when the target CELL changes.
      if (armedRef.current && dragRef.current?.mode !== 'move') {
        const mx = Number(g.getMouseX?.() ?? -1);
        const my = Number(g.getMouseY?.() ?? -1);
        const r = rectRef.current;
        const lx = mx - r.x, ly = my - r.y;
        if (lx >= 0 && ly >= 0 && lx <= r.width && ly <= r.height) {
          lastCursorRef.current = { x: lx, y: ly };
          const t = resolveAtRef.current(lx, ly);
          const k = t ? `${t.placement.x.toFixed(2)},${t.placement.y.toFixed(2)},${t.placement.z.toFixed(2)},${t.placement.yawDegrees}` : '';
          if (k !== ghostKeyRef.current) { ghostKeyRef.current = k; setSnap(t); }
        }
      }
      sched(tick);
    };
    sched(tick);
    return () => {
      alive = false;
      const nodeId = Number(loaderRef.current?.id ?? 0);
      if (nodeId && typeof g.__compiled_world_clear_camera === 'function') g.__compiled_world_clear_camera(nodeId);
    };
  }, [pushCamera, stage]);

  // Reload the gamefile IN PLACE after a re-bake (req_1760/1761). Unmount the host
  // runtime for this node; the next embedded render re-mounts from the fresh gamefile.
  // The camera pose survives because the host pending-camera table is keyed by node id.
  const reloadSeenRef = useRef(props.reloadToken);
  useEffect(() => {
    if (reloadSeenRef.current === props.reloadToken) return;
    reloadSeenRef.current = props.reloadToken;
    const nodeId = Number(loaderRef.current?.id ?? 0);
    if (nodeId && typeof g.__compiled_world_unmount === 'function') g.__compiled_world_unmount(nodeId);
    // The reload follows a fresh bake, so the loader is about to render the current piece
    // set — those are no longer "pending", and each prop's current skin is now its baked skin.
    bakedIdsRef.current = new Set(piecesRef.current.map((p) => p.id));
    bakedSigRef.current = new Map(piecesRef.current.map((p) => [p.id, pieceSkinSig(p)] as const));
  }, [props.reloadToken]);

  // LIVEHOST req_1798: push the just-placed-but-unbaked pieces to the native loader as a
  // LIVE box overlay, so a placement/move shows as a real solid mesh the instant you
  // commit — no full ~5s rebake. Recomputed whenever the piece set changes (a commit
  // mints a fresh pieces array) or after a reload re-baselines what's baked. Runs AFTER
  // the reload effect above (declared earlier → fires first), so on a reload bakedIdsRef
  // is already current and the overlay clears. The pending table in world_loader is keyed
  // by node id and survives unmount, so a push during a remount still lands next frame.
  useEffect(() => {
    if (!editable) return;
    const nodeId = Number(loaderRef.current?.id ?? 0);
    if (!nodeId) return;
    const baked = bakedIdsRef.current!;
    const current = props.pieces ?? [];
    const currentIds = new Set(current.map((p) => p.id));
    // tier-2 (req_1800): if a piece that WAS baked is no longer present, the user
    // deleted/moved/rotated pre-baked geometry. The overlay can't erase the baked mesh,
    // so request a settle bake to fold the change in. Pure placements keep every baked id
    // present → no bake, the overlay alone shows the new piece.
    for (const id of baked) {
      if (!currentIds.has(id)) { props.requestSettleBake?.(); break; }
    }
    const pending = current.filter((p) => !baked.has(p.id));
    // Two overlays, one per geometry kind: parts pieces/props → the box/shape instance overlay
    // (pieceInstanceRows, just-placed only); MESH props → the resident-mesh reference overlay
    // (meshPropLivePush, LIVEMESH req_1812). The mesh push gets the FULL set + baked skins so it
    // also catches EXISTING props re-skinned since the bake (RESKIN req_1845), not just new
    // placements. Empty arrays clear the host overlay, so we always push (no early return). The
    // mesh push also hands back the procedural skin materials the props wear (LIVESKIN req_1843)
    // — materialize those FIRST so refs that reference them by hash resolve this same frame.
    const rows = pieceInstanceRows(pending);
    const meshPush = meshPropLivePush(current, bakedSigRef.current!);
    // BUILDING-PIECE skins (LIVEBLDSKIN req_1849): a procedurally-skinned wall/floor face
    // renders as a live textured box outset over the baked face-slab — props can't cover this
    // (props are mesh refs), and building boxes are batched so they can't be hidden per-instance.
    const skinPush = buildingSkinBoxes(current);
    // Only the failure mode is worth a console line now (a host predating the live doors):
    // a successful push is the silent common case.
    if (typeof g.__compiled_world_set_live_pieces !== 'function' || typeof g.__compiled_world_set_live_mesh_props !== 'function') {
      console.warn(`[live-push] node=${nodeId} live doors MISSING (pieces=${typeof g.__compiled_world_set_live_pieces === 'function'} mesh=${typeof g.__compiled_world_set_live_mesh_props === 'function'}) — rebuild the dev host`);
    }
    // Materialize every skin material (mesh + building) FIRST, so refs/boxes that reference
    // them by hash resolve the same frame.
    if (typeof g.__compiled_world_set_live_material === 'function') {
      for (const m of meshPush.materials) g.__compiled_world_set_live_material(nodeId, m.hash, 0, m.wgsl, new Float32Array(m.data), m.opacity);
      for (const m of skinPush.materials) g.__compiled_world_set_live_material(nodeId, m.hash, 0, m.wgsl, new Float32Array(m.data), m.opacity);
    }
    if (typeof g.__compiled_world_set_live_pieces === 'function') g.__compiled_world_set_live_pieces(nodeId, rows);
    if (typeof g.__compiled_world_set_live_mesh_props === 'function') g.__compiled_world_set_live_mesh_props(nodeId, meshPush.refs);
    if (typeof g.__compiled_world_set_live_skin_boxes === 'function') g.__compiled_world_set_live_skin_boxes(nodeId, skinPush.boxes);
  }, [editable, props.pieces, props.reloadToken]);

  // LIVEMESH req_1841: the placement GHOST for a mesh prop is the REAL mesh, translucent,
  // tracking the snap target — far clearer than the faint projected wireframe (which stays
  // for parts props + as the footprint guide). Pushed on each snap/arm change; the host
  // owns one ghost ref per node and draws it with a forced alpha. Cleared when disarmed or
  // armed on a non-mesh kind so the wireframe stands alone.
  useEffect(() => {
    if (!editable) return;
    const nodeId = Number(loaderRef.current?.id ?? 0);
    if (!nodeId) return;
    let ref: Uint8Array | null = null;
    if (armed && armed.kind === 'piece' && snap) {
      let propKind: string | null = null;
      try { const def = GAME_BUILD.catalog.get(armed.id); if (def.kind === 'prop' && def.propKind) propKind = def.propKind; } catch { propKind = null; }
      if (propKind) ref = meshGhostRef(propKind, snap.placement.x, snap.placement.y, snap.placement.z, snap.placement.yawDegrees);
    }
    if (ref && typeof g.__compiled_world_set_live_mesh_ghost === 'function') g.__compiled_world_set_live_mesh_ghost(nodeId, ref);
    else if (typeof g.__compiled_world_clear_live_mesh_ghost === 'function') g.__compiled_world_clear_live_mesh_ghost(nodeId);
  }, [editable, armed, snap]);

  // ── pointer: rotate (drag empty), move (drag a selected piece), click = place/select.
  // gx0/gz0 hold the down point on the active plane so a move tracks the cursor's world
  // delta, not pixels; turned tells a drag from a click (>4px travel).
  const dragRef = useRef<{ x: number; x0: number; y0: number; turned: boolean; mode: 'rotate' | 'move' | 'paint'; gx0: number; gz0: number } | null>(null);
  // double-click whole-object select: the host has no dblclick event, so track
  // the last click's time + screen point (the QuadSplit double-press idiom).
  const lastClickRef = useRef({ t: 0, x: 0, y: 0 });
  const local = useCallback((e: any) => {
    const r = rectRef.current;
    return { x: Number(e?.x ?? 0) - r.x, y: Number(e?.y ?? 0) - r.y };
  }, []);
  const onDown = useCallback((e: any) => {
    const p = local(e);
    lastCursorRef.current = p;
    let mode: 'rotate' | 'move' | 'paint' = 'rotate';
    let gx0 = 0, gz0 = 0;
    if (editable && armedRef.current && paintKindOf(armedRef.current)) {
      // an armed wall/floor → a drag PAINTS a run/rect; record the start ground point.
      const gp = stage.groundPoint(p.x, p.y, rectRef.current);
      if (gp) { mode = 'paint'; gx0 = gp.x; gz0 = gp.z; }
    } else if (editable && !armedRef.current && selectedIdsRef.current.size) {
      const hit = GAME_BUILD.placed.raycast(stage.pieceRay(p.x, p.y, rectRef.current), piecesRef.current, ISO_SNAP_TUNING.reachMeters);
      if (hit && selectedIdsRef.current.has(hit.piece.id)) {
        const gp = stage.groundPoint(p.x, p.y, rectRef.current);
        if (gp) { mode = 'move'; gx0 = gp.x; gz0 = gp.z; }
      }
    }
    dragRef.current = { x: p.x, x0: p.x, y0: p.y, turned: false, mode, gx0, gz0 };
    if (armedRef.current) setSnap(resolveAt(p.x, p.y));
  }, [local, stage, editable, resolveAt, paintKindOf]);
  const onMove = useCallback((e: any) => {
    const p = local(e);
    lastCursorRef.current = p;
    const d = dragRef.current;
    if (d && Math.abs(p.x - d.x0) + Math.abs(p.y - d.y0) > 4) {
      d.turned = true;
      if (d.mode === 'paint') {
        const gp = stage.groundPoint(p.x, p.y, rectRef.current);
        if (gp) {
          const cells = computePaintCellsRef.current(armedRef.current, { x: d.gx0, z: d.gz0 }, gp);
          setPaintCells(cells.length ? cells : null);
        }
      } else if (d.mode === 'move') {
        const gp = stage.groundPoint(p.x, p.y, rectRef.current);
        if (gp) {
          const cs = props.state?.world.cellSizeMeters || 1;
          const dx = Math.round((gp.x - d.gx0) / cs) * cs;
          const dz = Math.round((gp.z - d.gz0) / cs) * cs;
          const cur = moveDeltaRef.current;
          if (!cur || cur.dx !== dx || cur.dz !== dz) setMoveDelta({ dx, dz });
        }
      } else {
        stage.rotateBy((p.x - d.x) * 0.3);
        d.x = p.x;
        pushCamera();
      }
      return;
    }
    if (armedRef.current) setSnap(resolveAt(p.x, p.y));
  }, [local, stage, pushCamera, resolveAt, props.state]);
  const onUp = useCallback(() => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (d.turned) {
      if (d.mode === 'move') commitMove();
      else if (d.mode === 'paint') commitPaint();
      return;
    }
    if (paintCellsRef.current) setPaintCells(null); // a click, not a drag — drop any preview
    if (!editable) return;
    // A click (no travel). While ARMED, shift/alt are placement modifiers
    // (shift=sub-grid, alt=freeform) — a click always places. While NOT armed,
    // the click selects: plain = single piece, Ctrl = toggle into a multi-select,
    // double-click = the whole connected object.
    if (armedRef.current) {
      const t = resolveAt(d.x0, d.y0);
      if (t) { setSnap(t); placeAt(t); }
    } else {
      const now = Date.now();
      const lc = lastClickRef.current;
      const dbl = now - lc.t < 350 && Math.abs(d.x0 - lc.x) < 6 && Math.abs(d.y0 - lc.y) < 6;
      lastClickRef.current = { t: now, x: d.x0, y: d.y0 };
      if (dbl) selectPieceAt(d.x0, d.y0, true);            // double-click = whole object
      else if (modRef.current.ctrl) togglePieceAt(d.x0, d.y0); // Ctrl-click = add/remove
      else selectPieceAt(d.x0, d.y0, false);               // single piece (replace)
    }
  }, [editable, commitMove, commitPaint, resolveAt, placeAt, selectPieceAt, togglePieceAt]);

  // ── 2D projected HUD (Approach B): the armed ghost box + selection outlines, drawn
  // each render through the SAME iso solve the loader renders with. Computed in the body
  // (not memoized) so it tracks the imperatively-driven camera; pushCamera() rerenders
  // while something is on the HUD. NO React Scene3D — this is the meshSelect.tsx overlay.
  const rect = rectRef.current;
  const ghostSegs: number[] = [];
  if (editable && armed && snap) {
    if (armed.kind === 'piece') {
      const sz = GAME_BUILD.catalog.get(armed.id).size;
      ghostSegs.push(...boxSegments(stage, rect, snap.placement.x, snap.placement.y, snap.placement.z, snap.placement.yawDegrees, sz.widthMeters, sz.heightMeters, sz.depthMeters));
    } else {
      // prefab / water: a 2m footprint marker at the snapped point (no plan size here).
      ghostSegs.push(...boxSegments(stage, rect, snap.placement.x, snap.placement.y, snap.placement.z, 0, 2, 0.3, 2));
    }
  }
  // Drag-paint preview (req_1801): the run/rect of cells the current wall/floor drag
  // would lay, drawn as green ghost boxes; committed as real meshes on release.
  const paintSegs: number[] = [];
  if (editable && paintCells) {
    for (const c of paintCells) {
      const sz = GAME_BUILD.catalog.get(c.pieceId).size;
      paintSegs.push(...boxSegments(stage, rect, c.x, c.y, c.z, c.yawDegrees, sz.widthMeters, sz.heightMeters, sz.depthMeters));
    }
  }
  // Selection outlines only. Just-placed-but-unbaked pieces no longer draw a 2D box here:
  // LIVEHOST (req_1798) renders them as REAL solid meshes via the native live overlay
  // (the live-push effect above), so the 2D amber placeholder is gone.
  const selSegs: number[] = [];
  if (editable && selectedIds.size) {
    const dx = moveDelta?.dx ?? 0, dz = moveDelta?.dz ?? 0;
    for (const pc of piecesRef.current) {
      if (!selectedIds.has(pc.id)) continue;
      const b = GAME_BUILD.placed.bounds(pc);
      const cx = (b.minX + b.maxX) / 2 + dx;
      const cz = (b.minZ + b.maxZ) / 2 + dz;
      selSegs.push(...boxSegments(stage, rect, cx, b.baseY, cz, 0, b.maxX - b.minX, b.topY - b.baseY, b.maxZ - b.minZ));
    }
  }

  return (
    <Box
      style={{ width: '100%', height: '100%', position: 'relative', backgroundColor: '#0d141f' }}
      onLayout={(lr: any) => { rectRef.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height }; }}
    >
      {createElement('WorldLoader', {
        ref: loaderRef,
        gameFile,
        storeDir,
        testID: 'loader-iso-view',
        style: { width: '100%', height: '100%' },
      })}

      {/* 2D projected overlay — identity view so points are plain pane pixels; never
          eats input (pointerEvents off). Selection under the ghost in paint order. */}
      {editable && (selSegs.length || ghostSegs.length || paintSegs.length) ? (
        <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, pointerEvents: 'none', overflow: 'visible' }}>
          <Graph style={{ width: rect.width, height: rect.height }} viewX={0} viewY={0} viewZoom={1} originTopLeft>
            {selSegs.length ? <Graph.Polyline segments points={selSegs} stroke="#7dd3fc" strokeWidth={2.4} /> : null}
            {paintSegs.length ? <Graph.Polyline segments points={paintSegs} stroke="#34d399" strokeWidth={1.4} /> : null}
            {ghostSegs.length ? <Graph.Polyline segments points={ghostSegs} stroke="#34d399" strokeWidth={1.6} /> : null}
          </Graph>
        </Box>
      ) : null}

      {/* pointer capture (near-transparent so it's hittable), same idiom as IsoAuthor */}
      <Pressable
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onScroll={(e: any) => {
          const dy = Number(e?.deltaY ?? 0);
          if (!dy) return;
          const r = rectRef.current;
          const mx = Number(g.getMouseX?.() ?? (r.x + r.width / 2));
          const my = Number(g.getMouseY?.() ?? (r.y + r.height / 2));
          stage.zoomToCursor(mx - r.x, my - r.y, dy > 0 ? 1.15 : 1 / 1.15, r);
          pushCamera();
        }}
        style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#00000001' }}
      />

      {/* FLOORLEVELS req_1857: the active-storey control — go up/down a floor and build on it.
          Above the capture layer so the buttons receive clicks ([ / ] also work). */}
      {editable ? (
        <Box style={{ position: 'absolute', left: 8, top: 8, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#0d141fdd', borderRadius: 6, padding: 4 }}>
          <Pressable onPress={() => changeLevel(-1)} style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1e293b', borderRadius: 4 }}>
            <Text style={{ color: '#cbd5e1', fontSize: 14 }}>▼</Text>
          </Pressable>
          <Text style={{ color: '#e2e8f0', fontSize: 12, minWidth: 52, textAlign: 'center' }}>{level === 0 ? 'Ground' : `Floor ${level}`}</Text>
          <Pressable onPress={() => changeLevel(1)} style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1e293b', borderRadius: 4 }}>
            <Text style={{ color: '#cbd5e1', fontSize: 14 }}>▲</Text>
          </Pressable>
        </Box>
      ) : null}

      {/* The build catalog rail — the SAME component IsoAuthor arms from (rule-of-two).
          Rendered last so it paints over (and receives clicks above) the capture layer. */}
      {editable ? (
        <CatalogRail
          armed={armed}
          prefabs={prefabs}
          onArm={(a) => { setArmed((cur) => (sameArmed(cur, a) ? null : a)); setSelectedIds(new Set()); }}
        />
      ) : null}
    </Box>
  );
}
