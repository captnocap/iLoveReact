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
import { useHeldModifiers } from './editors/useEditorControls';
import { buildResidentMeshCatalogLump } from './compile/worldGeometry';
import { subscribeCookedAssets } from './editors/model/cookedAssets';
import { stampEdit, takeEditStamp, nowMs, snapRenderTicks } from './editors/build/editLatency';
import { readFrameRecord, readCounters, framePhaseResidual } from './state/perfWatch';
import type { Armed } from './buildArmed';
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

// DIRTYRECT req_1891/1892: a baked piece's transform fingerprint (moved ⇒ changed) and its
// old-footprint AABB. When a piece moves/deletes, the loader erases the baked geometry at
// its old rect with no rebake; the live overlay draws the new spot. ERASE_MARGIN pads the
// rect a hair so float-rounded baked box centers land inside it, while staying well clear of
// any grid-neighbour's center (≥0.5m away) so a move never erases the tile next door.
const ERASE_MARGIN_METERS = 0.06;
function pieceXformSig(p: PlacedBuildPiece): string {
  return `${p.x}|${p.y}|${p.z}|${p.yawDegrees}`;
}
// WALLTOP-ERASE (req_2051): walls RENDER/BAKE lifted onto the floor beneath them
// (liftedWallBaseY, see pieceVisualShapes) — so the baked geometry sits at the LIFTED Y,
// not the stored Y. An erase rect built from the raw stored bounds has its Y window BELOW
// the baked rows, the host's center-in-rect Y-test misses them, and a deleted wall resting
// on a floor never collapses (it lingers as un-selectable stale geometry). Lift the piece
// the same way before taking its bounds so the rect's Y range straddles the real geometry.
// Needs the neighbour set to know which floor a wall rests on; props/floors aren't lifted
// (liftedWallBaseY returns piece.y for them), so this is a no-op for everything but walls.
function pieceEraseRect(p: PlacedBuildPiece, pieces: readonly PlacedBuildPiece[]): [number, number, number, number, number, number] {
  const restY = GAME_BUILD.placed.liftedWallBaseY(p, pieces);
  const lifted = restY !== p.y ? ({ ...p, y: restY } as PlacedBuildPiece) : p;
  const b = GAME_BUILD.placed.bounds(lifted);
  const m = ERASE_MARGIN_METERS;
  // Straddle BOTH the stored and lifted base so a hair of float drift in the lift can't drop
  // the floor of the window below the geometry; the top already covers the lifted height.
  const floorY = Math.min(b.baseY, p.y);
  return [b.minX - m, floorY - m, b.minZ - m, b.maxX + m, b.topY + m, b.maxZ + m];
}

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
  // EDITBASELINE (req_2049): false through the boot grace window while the world DATA loads
  // (`pieces` goes []→populated), true once it has settled. The live-erase baseline tracks
  // `pieces` while this is false (the loaded file IS the current state at boot), then FREEZES
  // when it flips true — so a later delete diffs against a real baked set, not the empty mount
  // snapshot. Without it the baseline stuck at the mount-time [] and deletes never erased.
  baselineReady?: boolean;
  // ── editing (req_1792): the SAME inputs index.tsx feeds IsoAuthor ──────────────
  state?: GameState;                                  // world under the pieces (terrain sampler)
  pieces?: readonly PlacedBuildPiece[];               // the standing pieces (pick/select/move target)
  buildings?: Readonly<Record<string, BuildingInstance>>; // instance refs (whole-building moves/deletes)
  prefabs?: readonly BuildPrefabDef[];                // the rail's prefab list (built-in + stream)
  onCommit?: (event: BuildEditEvent, label: string) => void;
  onCommitMany?: (items: ReadonlyArray<{ event: BuildEditEvent; label: string }>) => void;
  onSelectionChange?: (ids: ReadonlySet<string>) => void;
  onPlaceWaterBody?: (presetKind: string, x: number, z: number) => void;
  // RAILHOIST req_1888: the catalog rail moved OFF the map into the editor rail, so the
  // armed piece is now owned by the editor (index.tsx) and passed in. The map just reads
  // it (place/ghost) and clears it on cancel.
  armed?: Armed;
  onArm?: (next: Armed | ((cur: Armed) => Armed)) => void;
  // WALLHIDE req_2053: when true, the native loader hides every wall piece (baked + live)
  // so you can see and edit a building's interior. The editor (index.tsx) owns + persists it.
  hideWalls?: boolean;
}) {
  // req_1945: stamp when THIS pane starts rendering. The edit-latency line then splits the
  // `pre` re-render into [before-loader] (the shell + earlier panels) vs [loader-onward] (this
  // big pane's own render + its effects) — so the next cut targets the right one.
  g.__loaderRenderStart = nowMs();
  const gameFile = props.gameFile ?? DEFAULT_GAME_FILE;
  const storeDir = props.storeDir ?? DEFAULT_STORE_DIR;
  const editable = !!props.onCommit; // no commit door → a pure viewer (no rail/editing)
  const hideWalls = props.hideWalls ?? false; // WALLHIDE req_2053: "disable walls" to edit interiors

  const loaderRef = useRef<any>(null);
  const rectRef = useRef<Rect>({ x: 0, y: 0, width: 1, height: 1 });
  const rerender = useRerender();
  const rerenderRef = useRef(rerender);
  rerenderRef.current = rerender;

  const hideWallsRef = useRef(hideWalls);
  hideWallsRef.current = hideWalls;

  // WALLHIDE req_2058/2061: a piece is a wall if it PLACES as one — built-in wall pieces
  // AND Studio models cooked from a wall seed (catalog.family resolves both: a cooked
  // wall reports family 'wall' though its raw kind is 'prop').
  const isWallPieceId = useCallback((pieceId: string): boolean => {
    try { return GAME_BUILD.catalog.family(pieceId) === 'wall'; } catch { return false; }
  }, []);

  // ── live refs (the Pressable stale-closure discipline) ─────────────────────────
  const piecesRef = useRef(props.pieces ?? []);
  piecesRef.current = props.pieces ?? [];
  // WALLHIDE req_2061: the pieces a click/snap can HIT. While walls are hidden they must
  // also be UN-pickable so a click passes through to the item inside (a hidden wall that
  // still blocked selection was the whole complaint). Ref-based so the Pressable callbacks
  // read the live set without re-subscribing.
  const pickPieces = useCallback((): readonly PlacedBuildPiece[] => {
    const all = piecesRef.current;
    return hideWallsRef.current ? all.filter((p) => !isWallPieceId(p.pieceId)) : all;
  }, [isWallPieceId]);
  const buildingsRef = useRef(props.buildings);
  buildingsRef.current = props.buildings;
  const onCommitRef = useRef(props.onCommit);
  onCommitRef.current = props.onCommit;
  const onCommitManyRef = useRef(props.onCommitMany);
  onCommitManyRef.current = props.onCommitMany;
  // EDITLATENCY req_1924: stamp the gesture (keystroke/click) that starts an edit; the live-push
  // effect reads it after pushing to log keystroke→push (the React+push cost) and keystroke→
  // rendered (≈ one frame later). A baseline to beat as we drive the edit loop toward gameplay rate.
  const commitMany = useCallback((items: ReadonlyArray<{ event: BuildEditEvent; label: string }>) => {
    if (!items.length) return;
    stampEdit(items[0].label.split(' ')[0] || 'edit'); // verb from the first label: removed|moved|rotated|cloned
    const _c0 = nowMs(); // req_1942: split `pre` — the SYNCHRONOUS commit (apply + undo snapshot) vs the re-render
    if (onCommitManyRef.current) onCommitManyRef.current(items);
    else for (const it of items) onCommitRef.current?.(it.event, it.label);
    g.__lastCommitSyncMs = nowMs() - _c0;
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
  // armed is hoisted to the editor (req_1888) — read from props; set via props.onArm.
  const armed = props.armed ?? null;
  const setArmed = props.onArm ?? (() => {});
  const armedRef = useRef<Armed>(armed);
  armedRef.current = armed;
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  // Arming a piece (from the editor-rail catalog now, req_1888) clears any selection —
  // the behaviour the rail's onArm used to do inline before it moved off the map.
  useEffect(() => { if (armed && selectedIdsRef.current.size) setSelectedIds(new Set()); }, [armed]);
  // WALLHIDE req_2061: when walls are hidden, drop any SELECTED wall — its render + outline
  // are gone and it's now un-pickable, so it must leave the selection (no stranded blue
  // outline of a wall you can't see, no accidental move/delete of it).
  useEffect(() => {
    if (!hideWalls) return;
    setSelectedIds((prev) => {
      if (!prev.size) return prev;
      const next = new Set<string>();
      for (const id of prev) {
        const p = piecesRef.current.find((q) => q.id === id);
        if (p && isWallPieceId(p.pieceId)) continue; // drop the hidden wall
        next.add(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [hideWalls, isWallPieceId]);
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
  // Modifier state via the shared hook: it reads the SDL mod-mask FLAGS
  // (e.shiftKey/altKey/ctrlKey) off every key event. A modifier-only press has
  // no SDL_KEY_NAMES entry (it arrives as `sdl:NNN`, not `shift`), so matching
  // e.key by string never catches a held shift/alt — the flags are the truth.
  const modRef = useHeldModifiers();
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
  // DIRTYRECT req_1891/1892: each baked piece's transform sig + old-footprint rect, so a
  // MOVED or DELETED baked piece's stale geometry is erased live (no rebake). Re-baselined
  // on every reload (the fresh bake IS the new truth).
  const bakedRectRef = useRef<Map<string, { sig: string; rect: [number, number, number, number, number, number] }> | null>(null);
  if (bakedRectRef.current === null) {
    const seed = props.pieces ?? [];
    bakedRectRef.current = new Map(seed.map((p) => [p.id, { sig: pieceXformSig(p), rect: pieceEraseRect(p, seed) }] as const));
  }
  // The last erase-rect signature pushed to the host — so an unchanged set never re-bumps the
  // host generation (which re-stages the static world). Reset on reload to force the clear-push.
  const lastEraseSigRef = useRef<string>('');

  // Re-baseline the three "what the loaded file holds" refs to a piece set that IS the baked
  // truth — called both after a reload (the fresh bake is the new truth) and through the boot
  // grace window (the loaded file == current state until the first edit). Mirrors the lazy
  // init above; the rule-of-two helper so the two callers never drift.
  const rebaselineBaked = useCallback((pieces: readonly PlacedBuildPiece[]) => {
    bakedIdsRef.current = new Set(pieces.map((p) => p.id));
    bakedSigRef.current = new Map(pieces.map((p) => [p.id, pieceSkinSig(p)] as const));
    bakedRectRef.current = new Map(pieces.map((p) => [p.id, { sig: pieceXformSig(p), rect: pieceEraseRect(p, pieces) }] as const));
    lastEraseSigRef.current = '';
  }, []);

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
      // WALLHIDE req_2061: a hidden wall is non-pickable, so it must not catch the
      // placement snap either — you snap to the interior surfaces you can see.
      pieces: pickPieces(),
      groundTopAt: placeGroundAt,
      snap: snapMode,
      size,
      yawDegrees: ghostYawRef.current,
      freeform: modRef.current.alt,
      subgrid: modRef.current.shift,
      ...(prefabAnchor ? { anchorLocal: { x: prefabAnchor.x, z: prefabAnchor.z } } : {}),
      tuning: ISO_SNAP_TUNING,
    });
  }, [stage, placeGroundAt, pickPieces]);
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
      stampEdit('place·prefab');
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
    stampEdit('place');
    const _c0 = nowMs(); // req_1942: split `pre` — SYNCHRONOUS commit (apply + undo snapshot) vs the re-render
    onCommitRef.current?.({ kind: 'piecePlaced', placement }, `placed ${def.label} @ ${at}`);
    g.__lastCommitSyncMs = nowMs() - _c0;
  }, [props.onPlaceWaterBody]);

  // ── select: raycast the standing pieces. `whole` (double-click) selects the
  // connected object; otherwise the single hit piece. Empty space clears.
  const selectPieceAt = useCallback((sx: number, sy: number, whole: boolean) => {
    const hit = GAME_BUILD.placed.raycast(stage.pieceRay(sx, sy, rectRef.current), pickPieces(), ISO_SNAP_TUNING.reachMeters);
    if (!hit) { setSelectedIds(new Set()); return; }
    setSelectedIds(whole ? GAME_BUILD.placed.connected(hit.piece.id, piecesRef.current) : new Set([hit.piece.id]));
  }, [stage, pickPieces]);

  // ── multi-select (Ctrl-click): toggle the hit piece in/out of the running
  // selection instead of replacing it. Ctrl-click on empty space keeps the
  // selection (a missed click shouldn't wipe a multi-select in progress).
  const togglePieceAt = useCallback((sx: number, sy: number) => {
    const hit = GAME_BUILD.placed.raycast(stage.pieceRay(sx, sy, rectRef.current), pickPieces(), ISO_SNAP_TUNING.reachMeters);
    if (!hit) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(hit.piece.id)) next.delete(hit.piece.id);
      else next.add(hit.piece.id);
      return next;
    });
  }, [stage, pickPieces]);

  // ── select connected (G): grow the current selection to every piece that
  // transitively touches it — the whole connected structure(s) under the
  // selection, in one keystroke. Re-adds the smart-select reach the deleted
  // IsoAuthor had (req_2073): a double-click grabs ONE structure from a bare
  // click, but once you've multi-picked loose pieces, G floods each out to its
  // whole connected shape. Unions GAME_BUILD.placed.connected per seed (the same
  // walk double-click uses). No-op with nothing selected or nothing new to add.
  const selectConnectedToSelection = useCallback(() => {
    const ids = selectedIdsRef.current;
    if (!ids.size) return;
    const pieces = piecesRef.current;
    const next = new Set(ids);
    for (const seed of ids) {
      for (const id of GAME_BUILD.placed.connected(seed, pieces)) next.add(id);
    }
    if (next.size !== ids.size) setSelectedIds(next);
  }, []);

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
    // The piece's FAMILY, not its raw kind — a cooked floor is kind:'prop' but
    // places AS a floor, so it earns the floor's grid drag-paint (req_1944/1964).
    const k = GAME_BUILD.catalog.family(a.id);
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
      const k = String(e?.key ?? '').toLowerCase(); // modifiers tracked by useHeldModifiers (flags, not key string)
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
      // G floods the selection out to its whole connected structure(s) (req_2073).
      else if (editable && k === 'g' && selectedIdsRef.current.size) { selectConnectedToSelection(); }
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
    return () => { offDown(); offUp(); heldPanRef.current = {}; }; // modRef owned by useHeldModifiers
  }, [stage, pushCamera, props.centerX, props.centerZ, editable, deleteSelected, rotateSelected, cloneSelected, selectConnectedToSelection, changeLevel]);

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
      // TICKPROBE2 (req_1991, TEMP): this per-frame loader tick runs via setTimeout
      // (no host rAF) → inside __jsTick, which the partition fingered as the 260ms.
      // Time the whole body + the resolveSnapTarget hover poll (O(pieces) while armed)
      // separately, cart-side so it loads reliably. If THIS is ~260ms, the per-frame
      // hover snap over 9696 pieces is the stall — not a microtask, not the store.
      const _tk0 = g.performance?.now?.() ?? 0;
      let _resolveMs = 0;
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
          const _r0 = g.performance?.now?.() ?? 0;
          const t = resolveAtRef.current(lx, ly);
          _resolveMs = (g.performance?.now?.() ?? 0) - _r0;
          const k = t ? `${t.placement.x.toFixed(2)},${t.placement.y.toFixed(2)},${t.placement.z.toFixed(2)},${t.placement.yawDegrees}` : '';
          if (k !== ghostKeyRef.current) { ghostKeyRef.current = k; setSnap(t); }
        }
      }
      const _tkMs = (g.performance?.now?.() ?? 0) - _tk0;
      if (_tkMs > 20) console.warn(`[tickprobe2] loader per-frame tick took ${_tkMs.toFixed(1)}ms (resolveSnapTarget ${_resolveMs.toFixed(1)}ms over ${piecesRef.current.length} pieces, armed=${!!armedRef.current})`);
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
    // The reload follows a fresh bake, so the loader is about to render the current piece set —
    // those are no longer "pending", each prop's current skin is now its baked skin, and every
    // piece sits correctly, so drop all erase rects (stale ones would now eat the NEW geometry).
    rebaselineBaked(piecesRef.current);
    if (nodeId && typeof g.__compiled_world_set_dirty_erase === 'function') g.__compiled_world_set_dirty_erase(nodeId, new Float32Array(0));
  }, [props.reloadToken, rebaselineBaked]);

  // EDITBASELINE (req_2049): the mount-time baseline is captured from `pieces` at first render,
  // when the world DATA hasn't loaded yet (`pieces` is still []) — so the live-erase set started
  // EMPTY and a later delete had nothing to erase (the baked piece stayed). Through the boot grace
  // window (baselineReady false) keep the baseline tracking the settling `pieces`: the loaded file
  // IS that state at boot, no edits have happened yet, so this never hides a real edit. The moment
  // it flips true the baseline FREEZES on the settled set, and from there deletes/moves diff against
  // a true baked footprint. A bake-driven reload (above) still re-baselines on its own afterwards.
  useEffect(() => {
    if (props.baselineReady) return; // settled — freeze; real edits now diff against the baseline
    rebaselineBaked(props.pieces ?? []);
  }, [props.baselineReady, props.pieces, rebaselineBaked]);

  // FULLRES req_1909/1911/1912: the "fat & loaded" editor. On /editor entry — and whenever the
  // cooked-asset catalog changes (a new Studio compile→install lands while we're mounted) — push
  // the WHOLE cooked catalog to the loader as resident meshes. Every compiled asset is then
  // placeable/movable/skinnable INSTANTLY off residency, with zero world rebake. The push is the
  // one-time "build" moment (a lump encode); after it, the edit loop is gameplay-rate.
  useEffect(() => {
    if (!editable) return;
    const push = () => {
      const nodeId = Number(loaderRef.current?.id ?? 0);
      if (!nodeId || typeof g.__compiled_world_set_resident_meshes !== 'function') return;
      try { g.__compiled_world_set_resident_meshes(nodeId, buildResidentMeshCatalogLump()); }
      catch (e) { console.warn('[fullres] resident catalog push failed', e); }
    };
    push();
    return subscribeCookedAssets(push);
  }, [editable]);

  // WALLHIDE req_2053: push the "disable walls" toggle to the native loader so it hides every
  // baked wall row (collapse, no rebake) — letting you see + edit a building's interior. The live
  // overlay below additionally drops just-placed wall pieces while the toggle is on, so newly
  // built walls hide too. Re-pushed on a reload (the door is node-keyed and survives remount).
  useEffect(() => {
    const nodeId = Number(loaderRef.current?.id ?? 0);
    if (!nodeId || typeof g.__compiled_world_set_hide_walls !== 'function') return;
    g.__compiled_world_set_hide_walls(nodeId, hideWalls ? 1 : 0);
  }, [hideWalls, props.reloadToken]);

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
    const tEffect = nowMs(); // EDITLATENCY phase breakdown (req_1935)
    const baked = bakedIdsRef.current!;
    const bakedRects = bakedRectRef.current!;
    const current = props.pieces ?? [];
    const currentById = new Map(current.map((p) => [p.id, p] as const));
    // DIRTYRECT req_1891/1892: a baked piece is "dirty" when it's gone (deleted, or a loose
    // move that minted a new id) or its transform changed (a whole-building move keeps its id).
    // Push each dirty piece's OLD footprint as an erase rect — the loader collapses the baked
    // box rows + hides the baked mesh nodes inside it, so the stale geometry vanishes with no
    // rebake.
    //
    // NO-RECOMPILE-ON-DELETE (req_2048): a delete/move of a baked piece used to also fire a
    // 1.2s-debounced settle bake (~5s `game bake` + reload spinner) — the felt "recompiles at
    // every change" the user called out. It's redundant now: the live erase below already makes
    // the visual correct, the GameState DB already holds the deletion (source of truth), and the
    // live overlay RE-DERIVES the erase against the stale baked file every session (a reload or a
    // fresh restart re-baselines bakedRects from the file, then this very effect erases again).
    // Durable fold-in still happens lazily — index.tsx's dirty-on-buildPieces effect marks the
    // stem dirty so a map-switch/revisit re-bakes it in, exactly like a placement. So a delete is
    // now as instant and bake-free as a placement.
    const eraseRects: number[] = [];
    for (const [id, info] of bakedRects) {
      const cur = currentById.get(id);
      if (!cur) { eraseRects.push(...info.rect); continue; }       // gone: deleted or loose-moved
      if (pieceXformSig(cur) !== info.sig) eraseRects.push(...info.rect); // moved/rotated in place
    }
    // Only push when the erase set actually CHANGES — setDirtyErase bumps the host generation,
    // which re-stages the static world once; a plain placement (no dirty piece) must not trigger
    // that. The signature is the rounded rect list; identical → skip the push entirely.
    const eraseSig = eraseRects.map((v) => Math.round(v * 100)).join(',');
    if (eraseSig !== lastEraseSigRef.current && typeof g.__compiled_world_set_dirty_erase === 'function') {
      lastEraseSigRef.current = eraseSig;
      g.__compiled_world_set_dirty_erase(nodeId, new Float32Array(eraseRects));
    }
    // A baked piece that MOVED must also live-draw at its new spot (its baked copy is now
    // erased) — include it alongside the never-baked placements in the box/shape overlay.
    const pending = current.filter((p) => !baked.has(p.id) || pieceXformSig(p) !== bakedRects.get(p.id)?.sig);
    // Two overlays, one per geometry kind: parts pieces/props → the box/shape instance overlay
    // (pieceInstanceRows, just-placed only); MESH props → the resident-mesh reference overlay
    // (meshPropLivePush, LIVEMESH req_1812). The mesh push gets the FULL set + baked skins so it
    // also catches EXISTING props re-skinned since the bake (RESKIN req_1845), not just new
    // placements. Empty arrays clear the host overlay, so we always push (no early return). The
    // mesh push also hands back the procedural skin materials the props wear (LIVESKIN req_1843)
    // — materialize those FIRST so refs that reference them by hash resolve this same frame.
    const tScans = nowMs(); // EDITLATENCY: start of the O(N) overlay scans (req_1935)
    // WALLHIDE req_2053: while "disable walls" is on, drop wall-kind pieces from the LIVE overlay
    // too (the baked ones are collapsed by the loader door) so a just-placed/moved wall hides as
    // well — keeping the live and baked views consistent under the toggle.
    // A piece is a wall if it PLACES as one — built-in wall pieces AND Studio models
    // cooked from a wall seed (req_2058), which report family 'wall' though their raw
    // kind is 'prop'. catalog.family resolves both (catalogPieceFamily).
    const isWallPiece = (p: PlacedBuildPiece): boolean => {
      try { return GAME_BUILD.catalog.family(p.pieceId) === 'wall'; } catch { return false; }
    };
    const livePending = hideWalls ? pending.filter((p) => !isWallPiece(p)) : pending;
    const liveCurrent = hideWalls ? current.filter((p) => !isWallPiece(p)) : current;
    const rows = pieceInstanceRows(livePending);
    const meshPush = meshPropLivePush(liveCurrent, bakedSigRef.current!);
    // BUILDING-PIECE skins (LIVEBLDSKIN req_1849): a procedurally-skinned wall/floor face
    // renders as a live textured box outset over the baked face-slab — props can't cover this
    // (props are mesh refs), and building boxes are batched so they can't be hidden per-instance.
    const skinPush = buildingSkinBoxes(liveCurrent);
    const tScansEnd = nowMs(); // EDITLATENCY: O(N) overlay scans done (req_1935)
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
    // EDITLATENCY req_1924/req_1928/req_1934: this push is the edit's — take the gesture stamp and
    // log the matrix line. gesture→push is the React reconcile + push cost (the optimizable part);
    // one rAF later ≈ the host has drawn it, so gesture→rendered is the felt keystroke→on-screen
    // latency. console.WARN, not log — only warn+ severities reach the dev terminal (the same path
    // PLACEFREEZE uses); a console.log here was invisible (req_1934). Last sample on g.__hmscEditLatency.
    const stamp = takeEditStamp();
    if (stamp) {
      const tPush = nowMs();
      const { t, label } = stamp;
      // Phase breakdown (req_1935) so we kill the right thing, not guess:
      //   pre   = gesture → this effect runs (onCommit + parent stream apply + React reconcile)
      //   scans = the loader's O(N) overlay rebuild (pieceInstanceRows + meshPropLivePush + skins)
      //   push  = the host door calls themselves
      //   host  = push → the next frame can run (main thread blocked: snapshot/re-render/GPU upload)
      const pre = tEffect - t, scans = tScansEnd - tScans, push = tPush - tScansEnd, pushMs = tPush - t;
      const after = g.requestAnimationFrame ? g.requestAnimationFrame.bind(g) : (fn: () => void) => setTimeout(fn, 16);
      after(() => {
        const renderedMs = nowMs() - t;
        const host = renderedMs - pushMs;
        // HOST GROUND TRUTH (req_1938): the rAF batches under saturation, so host-block is backlog,
        // not a clean per-edit number. CONTIGUOUS PARTITION (req_1974/1975): name the host frame by
        // the EIGHT phases that tile it — no "other" to hide the answer in. The V8 app tick lands in
        // appTick; the per-frame 3D/subsystem step in prePaint; event-dispatch reconcile in events
        // (bridge is the measured Zig→JS time nested there). If nodes / scene3d instances CLIMB per
        // edit, the compounding is a leak, not a fixed cost.
        const fr = readFrameRecord();
        const c = readCounters();
        let hostLine = '';
        if (fr) {
          const phases: Array<[string, number]> = [
            ['events', fr.eventUs], ['appTick', fr.appTickUs], ['preLayout', fr.preLayoutUs], ['layout', fr.layoutUs],
            ['prePaint', fr.prePaintUs], ['paint', fr.paintUs], ['gpu', fr.gpuUs], ['post', fr.postFrameUs],
          ];
          const dom = phases.slice().sort((a, b) => b[1] - a[1])[0][0];
          const ms = (us: number) => (us / 1000).toFixed(1);
          const resid = framePhaseResidual(fr);
          hostLine = `  | host DOMINANT=${dom} events ${ms(fr.eventUs)} appTick ${ms(fr.appTickUs)} preLayout ${ms(fr.preLayoutUs)} layout ${ms(fr.layoutUs)} prePaint ${ms(fr.prePaintUs)} paint ${ms(fr.paintUs)} gpu ${ms(fr.gpuUs)} post ${ms(fr.postFrameUs)} resid ${ms(resid)} | bridge ${ms(fr.bridgeUs)} | nodes ${c.total ?? '?'} inst ${c.scene3d_instances ?? '?'} draws ${c.scene3d_draw_calls ?? '?'} meshes ${c.scene3d_meshes_collected ?? '?'}`;
        }
        g.__hmscEditLatency = { label, pushMs, renderedMs, pre, scans, push, host, frame: fr, counters: c, at: Date.now() };
        const f = (n: number) => n.toFixed(0).padStart(4);
        // req_1939/1942: split `pre` — the SYNCHRONOUS commit (stream apply + undo snapshot) vs the
        // re-render (everything React does before the loader effect). placementWorld is shown if it recomputed.
        const pwMs = Number(g.__lastPlacementWorldMs ?? 0);
        const csMs = Number(g.__lastCommitSyncMs ?? 0);
        const pw = pwMs > 0 ? `,pw ${pwMs.toFixed(0)}` : '';
        // req_1945: split the rerender — shell+earlier panels (before this pane rendered) vs this
        // pane onward. Uses the render-start stamp at the top of LoaderIsoView.
        const rStart = Number(g.__loaderRenderStart ?? 0);
        const beforeLoader = rStart > 0 ? Math.max(0, rStart - t) : 0;
        const loaderOnward = rStart > 0 ? Math.max(0, tEffect - rStart) : 0;
        // req_1965: split `shell` further — EditorShell's own body (its hooks/derives + element
        // creation) vs the CHILD panels rendered before the loader pane. Tells us whether the
        // remaining cost is the panels (memoize/stabilize) or the parent body (trim its derives).
        const bEnd = Number(g.__shellBodyEnd ?? 0), bStart = Number(g.__shellBodyStart ?? 0);
        const shellBody = bEnd > 0 && bStart > 0 ? Math.max(0, bEnd - bStart) : 0;
        const shellKids = bEnd > 0 && rStart > 0 ? Math.max(0, rStart - bEnd) : 0;
        const shellSplit = bEnd > 0 ? ` {body ${shellBody.toFixed(0)} + kids ${shellKids.toFixed(0)}}` : '';
        const preSplit = ` [commit ${csMs.toFixed(0)} + rerender ${Math.max(0, pre - csMs).toFixed(0)} (shell ${beforeLoader.toFixed(0)}${shellSplit} + loaderPane ${loaderOnward.toFixed(0)})${pw}]`;
        // req_1968: which child components actually re-rendered for THIS edit (the definitive answer)
        const ticks = snapRenderTicks();
        const prev = (g.__rtPrev ?? {}) as Record<string, number>;
        const changed = Object.keys(ticks).filter((k) => (ticks[k] ?? 0) > (prev[k] ?? 0));
        g.__rtPrev = ticks;
        const rtLine = `  | re-rendered: ${changed.length ? changed.join(',') : 'none'}`;
        console.warn(`[edit-latency] ${label.padEnd(7)} total ~${f(renderedMs)}ms = pre ${f(pre)}${preSplit} + scans ${f(scans)} + push ${f(push)} + host-block ${f(host)}${hostLine}${rtLine}`);
      });
    }
  }, [editable, props.pieces, props.reloadToken, hideWalls]);

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
      if (hideWalls && isWallPieceId(pc.pieceId)) continue; // WALLHIDE req_2061: no outline for a hidden wall
      // req_1902: VISUAL bounds — a prop exported off the ground (a walk-under shape) has
      // its mesh band lifted, so the outline wraps the real mesh instead of a ground box.
      const b = GAME_BUILD.placed.visualBounds(pc);
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

      {/* The build catalog rail lives in the EDITOR rail now (req_1888) — OFF the map.
          The map just renders clean; the editor owns `armed` and feeds it in. */}
    </Box>
  );
}
