// IsoAuthor — the Sims-style whole-map BUILD view. Same world the FreeFly inspect
// pane shows (preview==game), but authored from a locked iso camera: rotate in 90°
// detents, zoom, pan, pick a FLOOR LEVEL, and drop catalog pieces by clicking the
// ground. The whole point over the on-foot F2 build mode is scale + reach — lay out
// a city block, or skin a 4th-floor wall, without walking there.
//
// IN SYNC BY CONSTRUCTION: this pane authors the SAME model F2 does. It renders the
// standing city with the SAME PlacedPieceMeshes (extracted to editors/build), snaps
// with the SAME resolveSnapTarget (editors/build/snap), validates with the SAME
// GAME_BUILD.placed.validatePlacement, and commits the SAME piecePlaced WorldEvent
// to the SAME worldStream (via the onCommit the cart already uses for F2). The only
// thing different from F2 is the camera + that the ray comes from the cursor, not a
// crosshair. Place a wall here, it stands in F2 and in the game.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Pressable, Scene3D, Text } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import { busOn } from '@reactjit/hooks/useIFTTT';
import { GAME_BUILD } from './game';
import type { BuildFaceSlot, BuildPieceKind, BuildPrefabDef, BuildSkinSet, PlacedBuildPiece, Rect, WorldEvent, WorldGridState } from './game';
import { resolveSnapTarget, SNAP_TUNING_DEFAULTS, type SnapTarget } from './editors/build/snap';
import { pieceVisualShapes, VisualShapeMesh, PlacedPieceMeshes } from './editors/build/pieceMeshes';
import { BUILD_UI } from './editors/build/buildUi';
import { IsoStage, METERS_PER_LEVEL } from './isoStage';
import type { GameState } from '../hmsc/design';
import { WorldStatics } from '../hmsc/render3d/GameWorld3D';
import { LandformSurfaceCaptures } from '../hmsc/render3d/Landform';
import { PropSurfaceCaptures } from '../hmsc/render3d/PropCaptures';
import { TextureCapture } from './game/textures/registry';
import { groundColumnTop } from './Embodied';
import { CHUNK_TILES } from './chunks';

const FAR_CLIP = 4000;
// The iso eye sits BASE_DIST/zoom (~90–257m) from the ground, far past F2's 14m
// crosshair reach — so the ground march has to travel much further before it dips
// under the terrain. A coarser step keeps the per-move cost sane at that range.
const ISO_SNAP_TUNING = { ...SNAP_TUNING_DEFAULTS, reachMeters: 600, groundMarchStepMeters: 0.5 };

// The build palette, ruled-hotkey order first (floor, wall, ramp, roof), then the
// rest — same kinds F2's palette leads with. Each tab lists its catalog entries.
const PALETTE_KINDS: BuildPieceKind[] = ['floor', 'wall', 'ramp', 'roof', 'stairs', 'pillar', 'prop'];

const MOVE_KEYS = new Set(['w', 'a', 's', 'd']);
const ARROW_TO_WASD: Record<string, string> = { arrowup: 'w', arrowdown: 's', arrowleft: 'a', arrowright: 'd' };

// Where the view opens / recenters: the centroid of what's already built, so you
// start looking AT the map instead of an empty chunk corner. Empty map → chunk centre.
function contentCenter(pieces: readonly PlacedBuildPiece[]): [number, number] {
  if (!pieces.length) return [CHUNK_TILES / 2, CHUNK_TILES / 2];
  let sx = 0, sz = 0;
  for (const p of pieces) { sx += p.x; sz += p.z; }
  return [sx / pieces.length, sz / pieces.length];
}

// The material-skin texture ids the placed pieces reference — the SAME set F2 derives
// (skinTextureIdsFromSet) to mount each skin's TextureCapture. Without these mounts,
// nothing binds the `bldskin:<id>` texture a skinned piece points at and it renders
// flat, so the applied material "disappears" in this pane.
function skinTextureIds(pieces: readonly PlacedBuildPiece[]): string[] {
  const ids = new Set<string>();
  for (const p of pieces) {
    const set = p.skin as BuildSkinSet | undefined;
    if (!set) continue;
    for (const slot of GAME_BUILD.skins.slots as readonly BuildFaceSlot[]) {
      const skin = set[slot];
      if (skin?.kind === 'material') ids.add(skin.id);
    }
  }
  return [...ids].sort();
}

// What's armed to place: a single catalog PIECE, or a PREFAB (a named composition that
// stamps into many pieces). null = nothing armed (pan/select mode).
type Armed = { kind: 'piece' | 'prefab'; id: string } | null;

export interface IsoAuthorProps {
  // The world to draw UNDER the pieces (terrain + props), same GameState the inspect
  // pane renders — preview==game.
  state: GameState;
  // The standing pieces (the cart's materialized worldStream truth) + the commit the
  // cart already funnels F2 placements through. This pane is just another caller.
  pieces: readonly PlacedBuildPiece[];
  onCommit: (event: WorldEvent, label: string) => void;
  // The FULL prefab list — built-ins AND the user-captured (stream) prefabs the cart
  // already merges for F2. The rail shows these; absent = built-ins only.
  prefabs?: readonly BuildPrefabDef[];
  // World (x,z) -> ground height (m). Level-0 picks follow it; absent = flat ground.
  groundTopAt?: (x: number, z: number) => number;
  // WASD/key focus is owned by the cart (shared across panes); true = this pane
  // drives input. A click here claims it.
  focused?: boolean;
  onFocus?: () => void;
}

export const IsoAuthor = memo(function IsoAuthor(props: IsoAuthorProps) {
  const { state, pieces, onCommit } = props;
  const prefabs = props.prefabs ?? GAME_BUILD.prefabs.ids.map((id) => GAME_BUILD.prefabs.get(id));
  // Prefab def by id (built-in + stream), for the ghost/stamp/label — a stream prefab
  // isn't in GAME_BUILD.prefabs, so look it up here. A ref too: placeAt runs from an
  // event closure that mustn't capture a stale list.
  const prefabById = useMemo(() => new Map(prefabs.map((d) => [d.id, d])), [prefabs]);
  const prefabByIdRef = useRef(prefabById);
  prefabByIdRef.current = prefabById;
  // Mount each placed skin's material TextureCapture so skinned pieces actually wear it.
  const skinIds = useMemo(() => skinTextureIds(pieces), [pieces]);
  // Terrain-following picks: snap against the SAME groundColumnTop F2 uses (painted
  // landform tops, regardless of the cursor's y), so level-0 placements drape over
  // painted hills exactly as F2's do. The WorldGridState is the thin {regions,cells,
  // landforms} view of state.world (kept inline rather than importing Embodied's
  // worldGridOf, which a parallel lane is actively editing). The prop can override.
  const worldGrid = useMemo<WorldGridState>(() => ({
    cellSizeMeters: state.world.cellSizeMeters,
    surfaceRegions: state.world.surfaceRegions as unknown as WorldGridState['surfaceRegions'],
    placedCells: state.world.placedCells as unknown as WorldGridState['placedCells'],
    landforms: (state.world.landforms ?? []) as unknown as WorldGridState['landforms'],
  }), [state]);
  const groundTopAt = useMemo<(x: number, z: number) => number>(
    () => props.groundTopAt ?? ((x, z) => groundColumnTop(worldGrid, x, z)),
    [props.groundTopAt, worldGrid],
  );

  // The camera controller, seeded centred on what's already built. Pose lives in the
  // ref; a tick forces the Scene3D.Camera to re-read the solved pose on pan/zoom/turn.
  const stageRef = useRef<IsoStage | null>(null);
  if (!stageRef.current) {
    const [cx, cz] = contentCenter(pieces);
    stageRef.current = new IsoStage({ centerX: cx, centerZ: cz, zoom: 1, level: 0 }, groundTopAt);
  }
  const stage = stageRef.current;
  useEffect(() => { stage.setHeightSampler(groundTopAt); }, [stage, groundTopAt]);
  const [, bump] = useState(0);
  const redraw = useCallback(() => bump((n) => (n + 1) & 0xffff), []);
  const recenter = useCallback(() => { const [cx, cz] = contentCenter(piecesRef.current); stage.centerOn(cx, cz); redraw(); }, [stage, redraw]);

  const [armed, setArmed] = useState<Armed>(null);
  const armedRef = useRef<Armed>(armed);
  armedRef.current = armed;
  const [ghostYaw, setGhostYaw] = useState(0);
  const ghostYawRef = useRef(ghostYaw);
  ghostYawRef.current = ghostYaw;
  const [snap, setSnap] = useState<SnapTarget | null>(null);
  // Selection (for delete/clone). markedIds highlights them in the SAME renderer F2
  // uses. wholeBuilding = a click grabs the connected shape (a whole building) vs one
  // piece — GAME_BUILD.placed.connected, the same "smart select" F2's G key does.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const [wholeBuilding, setWholeBuilding] = useState(true);
  const wholeBuildingRef = useRef(wholeBuilding);
  wholeBuildingRef.current = wholeBuilding;
  const piecesRef = useRef(pieces);
  piecesRef.current = pieces;
  const rectRef = useRef<Rect>({ x: 0, y: 0, width: 800, height: 600 });

  // Resolve the cursor to a snap target with the SAME inputs F2 uses (the armed
  // catalog entry's snap mode + size, the ghost yaw, the standing pieces).
  const resolveAt = useCallback((sx: number, sy: number): SnapTarget | null => {
    const a = armedRef.current;
    if (!a) return null;
    // A piece snaps by its own catalog rule (walls edge-snap, etc.); a prefab drops on
    // the grid by its origin — exactly how F2's place() picks snap/size.
    const snap = a.kind === 'prefab' ? 'grid' : GAME_BUILD.catalog.get(a.id).snap;
    const size = a.kind === 'prefab' ? { widthMeters: 1, heightMeters: 3, depthMeters: 1 } : GAME_BUILD.catalog.get(a.id).size;
    return resolveSnapTarget({
      ray: stage.pieceRay(sx, sy, rectRef.current),
      pieces: piecesRef.current,
      groundTopAt,
      snap,
      size,
      yawDegrees: ghostYawRef.current,
      tuning: ISO_SNAP_TUNING,
    });
  }, [stage, groundTopAt]);
  // The per-frame ghost poll (below) reads the latest resolveAt through this ref, so it
  // never snaps against a stale world/terrain after a paint edit.
  const resolveAtRef = useRef(resolveAt);
  resolveAtRef.current = resolveAt;
  const ghostKeyRef = useRef('');

  // Pointer. A DRAG rotates the view (yaw from horizontal motion — WASD does the
  // panning). A CLICK (no drag) acts at the cursor: place the armed piece, or select
  // the piece under it. Place/select fire on mouse-UP so a rotate-drag never drops a
  // piece; click vs drag is told by travel (>4px = a turn).
  const dragRef = useRef<{ x: number; x0: number; y0: number; turned: boolean } | null>(null);
  const local = (e: any): { x: number; y: number } => {
    const r = rectRef.current;
    return { x: Number(e?.x ?? 0) - r.x, y: Number(e?.y ?? 0) - r.y };
  };

  const onDown = (e: any) => {
    props.onFocus?.();
    const p = local(e);
    dragRef.current = { x: p.x, x0: p.x, y0: p.y, turned: false };
    if (armedRef.current) setSnap(resolveAt(p.x, p.y));
  };
  const onMove = (e: any) => {
    const p = local(e);
    const d = dragRef.current;
    if (d && Math.abs(p.x - d.x0) + Math.abs(p.y - d.y0) > 4) {
      d.turned = true;
      stage.rotateBy((p.x - d.x) * 0.3); // horizontal drag → yaw
      d.x = p.x;
      redraw();
      return;
    }
    if (armedRef.current) setSnap(resolveAt(p.x, p.y));
  };
  const onUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.turned) return; // a rotate, not a click
    if (armedRef.current) {
      const t = resolveAt(d.x0, d.y0);
      if (t) { setSnap(t); placeAt(t); }
    } else {
      selectAt(d.x0, d.y0);
    }
  };

  const placeAt = (t: SnapTarget) => {
    const a = armedRef.current;
    if (!a) return;
    const at = `${t.placement.x.toFixed(1)},${t.placement.z.toFixed(1)}`;
    if (a.kind === 'prefab') {
      // A prefab commits ONE prefabStamped event; the stream decomposes it into its
      // pieces — the SAME path F2's place() takes for a prefab. The def lookup spans
      // built-in AND stream prefabs.
      const def = prefabByIdRef.current.get(a.id);
      if (!def) return;
      onCommit({ kind: 'prefabStamped', prefabId: a.id, origin: { x: t.placement.x, y: t.placement.y, z: t.placement.z }, yawDegrees: t.placement.yawDegrees }, `stamped ${def.label} @ ${at}`);
      return;
    }
    const def = GAME_BUILD.catalog.get(a.id);
    const placement = { pieceId: def.id, x: t.placement.x, y: t.placement.y, z: t.placement.z, yawDegrees: t.placement.yawDegrees };
    if (GAME_BUILD.placed.validatePlacement(placement).length > 0) return;
    onCommit({ kind: 'piecePlaced', placement }, `placed ${def.label} @ ${at}`);
  };

  // Select the piece under the cursor (raycast the standing pieces) — the whole
  // connected building, or a single piece. Empty click clears.
  const selectAt = (sx: number, sy: number) => {
    const hit = GAME_BUILD.placed.raycast(stage.pieceRay(sx, sy, rectRef.current), piecesRef.current, ISO_SNAP_TUNING.reachMeters);
    if (!hit) { setSelectedIds(new Set()); return; }
    setSelectedIds(wholeBuildingRef.current ? GAME_BUILD.placed.connected(hit.piece.id, piecesRef.current) : new Set([hit.piece.id]));
  };
  // Remove every selected piece (one pieceRemoved each, the SAME event F2's X commits).
  const deleteSelected = () => {
    const ids = [...selectedIdsRef.current];
    if (!ids.length) return;
    for (const id of ids) onCommit({ kind: 'pieceRemoved', id }, `removed ${id}`);
    setSelectedIds(new Set());
  };
  // Duplicate the selection beside itself: re-emit piecePlaced for each piece, shifted
  // clear along +x by the selection's own width (the stream mints fresh ids).
  const cloneSelected = () => {
    const sel = piecesRef.current.filter((p) => selectedIdsRef.current.has(p.id));
    if (!sel.length) return;
    let minX = Infinity, maxX = -Infinity;
    for (const p of sel) { const b = GAME_BUILD.placed.bounds(p); minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX); }
    const dx = (maxX - minX) + state.world.cellSizeMeters;
    for (const p of sel) {
      onCommit({ kind: 'piecePlaced', placement: { pieceId: p.pieceId, x: p.x + dx, y: p.y, z: p.z, yawDegrees: p.yawDegrees } }, `cloned ${p.pieceId}`);
    }
  };

  // Latest delete/clone closures, so the once-mounted key listener always calls the
  // current ones (they read live refs + the current onCommit).
  const keyActionsRef = useRef({ deleteSelected, cloneSelected, recenter });
  keyActionsRef.current = { deleteSelected, cloneSelected, recenter };

  // Keys (while focused): R rotates the ghost, Q/E turn the view, Delete/Backspace
  // removes the selection, Esc disarms / clears the selection.
  useEffect(() => {
    if (!props.focused) return;
    const off = busOn('__keydown', (e: any) => {
      const k = String(e?.key ?? '').toLowerCase();
      if (k === 'r') setGhostYaw((y) => (y + 90) % 360);
      else if (k === 'escape') { setArmed(null); setSelectedIds(new Set()); }
      else if (k === 'q') { stage.rotate(-1); redraw(); }
      else if (k === 'e') { stage.rotate(1); redraw(); }
      else if (k === 'f' || k === 'home') keyActionsRef.current.recenter();
      else if (k === 'delete' || k === 'backspace') keyActionsRef.current.deleteSelected();
    });
    return off;
  }, [props.focused, stage, redraw]);

  // WASD / arrow keys slide the view across the ground (held-key pan loop). Speed
  // scales with the eye distance so a keystroke crosses the same fraction of the view
  // at every zoom. The loop only runs while this pane is focused.
  useEffect(() => {
    if (!props.focused) return;
    const held: Record<string, boolean> = {};
    const key = (e: any): string => { const k = String(e?.key ?? '').toLowerCase(); return ARROW_TO_WASD[k] ?? k; };
    const offD = busOn('__keydown', (e: any) => { const k = key(e); if (MOVE_KEYS.has(k)) held[k] = true; });
    const offU = busOn('__keyup', (e: any) => { const k = key(e); if (MOVE_KEYS.has(k)) held[k] = false; });
    const G: any = globalThis;
    const sched = G.requestAnimationFrame ? G.requestAnimationFrame.bind(G) : (fn: any) => setTimeout(fn, 16);
    const cancel = G.cancelAnimationFrame ? G.cancelAnimationFrame.bind(G) : clearTimeout;
    let handle: any = 0;
    let last = G.performance?.now?.() ?? 0;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const now = G.performance?.now?.() ?? last + 16;
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      const forward = (held.w ? 1 : 0) - (held.s ? 1 : 0);
      const strafe = (held.d ? 1 : 0) - (held.a ? 1 : 0);
      if (forward || strafe) {
        const speed = Math.max(18, stage.distance() * 0.85); // m/s, scales with zoom
        stage.nudge(forward * speed * dt, strafe * speed * dt);
        redraw();
      }
      // Hover ghost: while a piece is armed, the translucent preview follows the cursor.
      // The host fires NO passive move events (on_mouse_move only during a drag), so we
      // poll getMouseX/Y here. Only when the cursor is over this pane, and only re-snap
      // when the target CELL changes, so the ghost doesn't thrash a re-render every frame.
      if (armedRef.current) {
        const mx = Number(G.getMouseX?.() ?? -1);
        const my = Number(G.getMouseY?.() ?? -1);
        const r = rectRef.current;
        const lx = mx - r.x;
        const ly = my - r.y;
        if (lx >= 0 && ly >= 0 && lx <= r.width && ly <= r.height) {
          const t = resolveAtRef.current(lx, ly);
          const k = t ? `${t.placement.x.toFixed(2)},${t.placement.y.toFixed(2)},${t.placement.z.toFixed(2)},${t.placement.yawDegrees}` : '';
          if (k !== ghostKeyRef.current) { ghostKeyRef.current = k; setSnap(t); }
        }
      }
      handle = sched(tick);
    };
    handle = sched(tick);
    return () => { alive = false; cancel(handle); offD(); offU(); };
  }, [props.focused, stage, redraw]);

  const cam = stage.solve();
  const level = stage.pose.level;

  // The placement ghost: the armed piece drawn translucent at the snapped pose,
  // tinted blocked-red when validatePlacement refuses it — F2's ghost, in iso.
  const ghostMeshes = useMemo(() => {
    const a = armedRef.current;
    if (!a || !snap) return null;
    const yaw = snap.placement.yawDegrees;
    // A prefab previews ALL of its stamped pieces; a single piece previews itself. The
    // prefab def spans built-in + stream (prefabById); bail if it's somehow unknown.
    const prefabDef = a.kind === 'prefab' ? prefabById.get(a.id) : null;
    if (a.kind === 'prefab' && !prefabDef) return null;
    const previews = prefabDef
      ? GAME_BUILD.placed.stamp(prefabDef, { x: snap.placement.x, y: snap.placement.y, z: snap.placement.z }, yaw)
      : [{ pieceId: a.id, x: snap.placement.x, y: snap.placement.y, z: snap.placement.z, yawDegrees: yaw }];
    const blocked = a.kind === 'piece' && GAME_BUILD.placed.validatePlacement(previews[0] as any).length > 0;
    const color = blocked ? BUILD_UI.ghostBlockedColor : BUILD_UI.ghostColor;
    return previews.flatMap((p, i) => pieceVisualShapes(p, `isoGhost${i}`).map((shape) => (
      <VisualShapeMesh key={shape.kind === 'ramp' ? shape.ramp.key : shape.box.key} shape={shape} colorOverride={color} opacityOverride={BUILD_UI.ghostOpacity} />
    )));
  }, [snap, armed, prefabById]);

  const noIds = useMemo(() => new Set<string>(), []);

  // Cut-away walls: fade every piece that sits ABOVE the active floor so you can see
  // (and build) into the storey you're editing — the Sims "view this level" move,
  // tied to the floor selector. Reuses the renderer's occluded-piece fade path, so
  // it costs nothing extra and looks exactly like F2's wall cut-away.
  const occludedIds = useMemo(() => {
    const cut = (level + 1) * METERS_PER_LEVEL - 0.01;
    const s = new Set<string>();
    for (const p of pieces) if (p.y >= cut) s.add(p.id);
    return s;
  }, [pieces, level]);

  return (
    <Box
      onLayout={(lr: any) => { rectRef.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height }; }}
      style={{ width: '100%', height: '100%', position: 'relative' }}
    >
      <LandformSurfaceCaptures landforms={state.world.landforms ?? []} />
      <PropSurfaceCaptures props={state.world.props} />
      {/* bind each placed skin's material texture (the SAME staticKey the renderer's
          textureKey points at) so skinned pieces wear their material — F2 does this. */}
      {skinIds.map((id) => (
        <TextureCapture
          key={id}
          textureId={id}
          staticKey={`bldskin:${id}`}
          widthPx={BUILD_UI.buildingSkinTexturePx}
          heightPx={BUILD_UI.buildingSkinTexturePx}
          cols={1}
          floors={1}
          perception={state.player.perception}
        />
      ))}
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#0a1018" showAxes={false}>
        <Scene3D.Camera position={cam.pos} target={cam.target} fov={cam.fov} far={FAR_CLIP} />
        <Scene3D.Fog enabled={false} />
        <WorldStatics world={state.world} skyConfig={state.config.sky} />
        {/* the build grid on the active floor (Scene3D's showGrid is a no-op — we draw
            our own tile lines, world-anchored, following the camera) */}
        <IsoGrid centerX={stage.pose.centerX} centerZ={stage.pose.centerZ} level={level} />
        {/* the standing city — the SAME renderer F2 uses; selection highlighted,
            floors above the active level faded (cut-away) so you see the interior */}
        <PlacedPieceMeshes pieces={pieces} markedIds={selectedIds} targetId={null} occludedIds={occludedIds} />
        {ghostMeshes}
      </Scene3D>

      {/* pointer capture (near-transparent so it's hittable). onScroll rides the raw
          wheel delta (events.zig) — zoom toward the cursor, map-style. */}
      <Pressable
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onScroll={(e: any) => {
          const d = Number(e?.deltaY ?? 0);
          if (!d) return;
          const p = local(e);
          stage.zoomToCursor(p.x, p.y, d > 0 ? 1.15 : 1 / 1.15, rectRef.current);
          redraw();
        }}
        style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#00000001' }}
      />

      {/* ── Sims control cluster (top-right): rotate · zoom · floor ────────── */}
      <Box style={{ position: 'absolute', right: 8, top: 8, flexDirection: 'row', gap: 4 }}>
        <IsoBtn label="⌂" onPress={recenter} />
        <IsoBtn label="⟲" onPress={() => { stage.rotate(-1); redraw(); }} />
        <IsoBtn label="⟳" onPress={() => { stage.rotate(1); redraw(); }} />
        <IsoBtn label="−" onPress={() => { stage.zoomBy(1 / 1.25); redraw(); }} />
        <IsoBtn label="+" onPress={() => { stage.zoomBy(1.25); redraw(); }} />
        <IsoBtn label="▼" onPress={() => { stage.lowerLevel(); redraw(); }} />
        <Box style={{ paddingLeft: 6, paddingRight: 6, paddingTop: 4, paddingBottom: 4, backgroundColor: BUILD_UI.panelBg, borderRadius: 4 }}>
          <Text fontSize={10} color="#cbd5e1" style={{ fontFamily: 'monospace' }}>{`F${level}`}</Text>
        </Box>
        <IsoBtn label="▲" onPress={() => { stage.raiseLevel(); redraw(); }} />
        <IsoBtn label={wholeBuilding ? '▦' : '▪'} onPress={() => setWholeBuilding((v) => !v)} />
        {selectedIds.size > 0 ? (
          <>
            <IsoBtn label="⧉" onPress={cloneSelected} />
            <IsoBtn label="✕" onPress={deleteSelected} />
          </>
        ) : null}
      </Box>

      {/* ── catalog rail (bottom): pick a piece to place ───────────────────── */}
      <CatalogRail prefabs={prefabs} armed={armed} onArm={(a) => { setArmed((cur) => (cur && cur.id === a.id && cur.kind === a.kind ? null : a)); setSelectedIds(new Set()); }} />

      <Text fontSize={9} color={props.focused ? '#7dd3fc' : '#475569'} style={{ fontFamily: 'monospace', position: 'absolute', left: 8, top: 34 }}>
        {armed
          ? `place: ${(armed.kind === 'prefab' ? prefabById.get(armed.id)?.label ?? armed.id : GAME_BUILD.catalog.get(armed.id).label)} · click to place · drag rotate · WASD pan · scroll zoom · R · Esc`
          : selectedIds.size > 0
            ? `${selectedIds.size} selected · ⧉ clone · ✕/Del remove · ${wholeBuilding ? 'building' : 'one piece'}`
            : 'WASD pan · drag rotate · scroll zoom · F recenter · click to select · pick below to build'}
      </Text>
      {/* what's in the map — the "junk" is the real placed pieces + world props (the
          same content F2/the game shows); ones off the painted chunk float over sky */}
      <Text fontSize={9} color="#64748b" style={{ fontFamily: 'monospace', position: 'absolute', left: 8, top: 48 }}>
        {`${pieces.length} pieces · ${state.world.props?.length ?? 0} props`}
      </Text>
    </Box>
  );
});

function IsoBtn(props: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress}>
      <Box style={{ width: 26, height: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: BUILD_UI.panelBg, borderRadius: 4 }}>
        <Text fontSize={12} color="#cbd5e1">{props.label}</Text>
      </Box>
    </Pressable>
  );
}

// The build grid: tile lines on the active floor, world-anchored, recentred in coarse
// steps so a pan doesn't churn the mesh list every frame and a zoomed-out view doesn't
// spawn thousands of lines. (Scene3D's showGrid prop is a no-op — nothing in the
// framework draws it — so the grid IS these thin line boxes.) Major line every 8 tiles.
// Recentre every SINGLE tile (not every 4) so the patch glides with the camera instead
// of jumping in big steps — the line keys are stable, so a tile-cross just UPDATEs
// positions, no churn. Lines are thick and bright (minor + a bold major every 8 tiles)
// so the grid reads clearly instead of as faint hairlines.
const GRID_SNAP = 1;
const GRID_RADIUS = 26;  // tiles each way (~52m patch)
const GRID_MINOR = '#3c5575';
const GRID_MAJOR = '#7da0cf';
const IsoGrid = memo(function IsoGrid(props: { centerX: number; centerZ: number; level: number }) {
  const cx = Math.round(props.centerX);
  const cz = Math.round(props.centerZ);
  const y = props.level * METERS_PER_LEVEL + 0.04; // above the floor so it never z-fights
  const span = GRID_RADIUS * 2;
  const lines: any[] = [];
  for (let i = -GRID_RADIUS; i <= GRID_RADIUS; i += 1) {
    const majorX = (cx + i) % 8 === 0;
    lines.push(
      <Scene3D.Mesh key={`gx${i}`} geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }}
        scale={[majorX ? 0.22 : 0.08, 0.05, span]} position={[cx + i, y, cz]}
        material={{ color: majorX ? GRID_MAJOR : GRID_MINOR, opacity: majorX ? 0.9 : 0.7 }} />,
    );
    const majorZ = (cz + i) % 8 === 0;
    lines.push(
      <Scene3D.Mesh key={`gz${i}`} geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }}
        scale={[span, 0.05, majorZ ? 0.22 : 0.08]} position={[cx, y, cz + i]}
        material={{ color: majorZ ? GRID_MAJOR : GRID_MINOR, opacity: majorZ ? 0.9 : 0.7 }} />,
    );
  }
  return <>{lines}</>;
}, (p, n) =>
  Math.round(p.centerX) === Math.round(n.centerX)
  && Math.round(p.centerZ) === Math.round(n.centerZ)
  && p.level === n.level);

// The bottom build palette. A row of kind tabs (floor/wall/ramp/...) and, under the
// active tab, that kind's catalog entries as chips — the Sims bottom bar, fed by the
// SAME BUILD_CATALOG the F2 palette reads.
type RailTab = BuildPieceKind | 'prefabs';
const RAIL_TABS: RailTab[] = [...PALETTE_KINDS, 'prefabs'];
const CatalogRail = memo(function CatalogRail(props: { armed: Armed; prefabs: readonly BuildPrefabDef[]; onArm: (a: { kind: 'piece' | 'prefab'; id: string }) => void }) {
  const [tab, setTab] = useState<RailTab>('wall');
  // 'prefabs' lists the named compositions (stamp → many pieces) — the FULL list the cart
  // passes (built-in + user-captured stream prefabs); every other tab lists that kind's
  // catalog pieces. Both feed the SAME rail, fed by the SAME GAME_BUILD.
  const entries = useMemo<{ id: string; label: string }[]>(
    () => (tab === 'prefabs' ? props.prefabs.map((d) => ({ id: d.id, label: d.label })) : GAME_BUILD.catalog.byKind(tab)),
    [tab, props.prefabs],
  );
  const armKind: 'piece' | 'prefab' = tab === 'prefabs' ? 'prefab' : 'piece';
  return (
    <Box style={{ position: 'absolute', left: 8, right: 8, bottom: 8, backgroundColor: '#0b1220fa', borderRadius: 6, borderWidth: 1, borderColor: '#1e3a5f', padding: 8, gap: 6 }}>
      <Text fontSize={10} color="#7dd3fc" style={{ fontFamily: 'monospace', fontWeight: 700 }}>
        {`${tab === 'prefabs' ? 'PREFABS' : 'PIECES'} — ${tab} (${entries.length}) · click one, then click the ground`}
      </Text>
      <Box style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
        {RAIL_TABS.map((k) => (
          <Pressable key={k} onPress={() => setTab(k)}>
            <Box style={{ paddingLeft: 9, paddingRight: 9, paddingTop: 4, paddingBottom: 4, borderRadius: 4, backgroundColor: k === tab ? '#2563eb' : (k === 'prefabs' ? '#3b2a5e' : '#1e293b') }}>
              <Text fontSize={11} color={k === tab ? '#eaf4ff' : '#a8b6c8'} style={{ fontFamily: 'monospace' }}>{k}</Text>
            </Box>
          </Pressable>
        ))}
      </Box>
      <Box style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap' }}>
        {entries.map((def) => (
          <Pressable key={def.id} onPress={() => props.onArm({ kind: armKind, id: def.id })}>
            <Box style={{ paddingLeft: 9, paddingRight: 9, paddingTop: 6, paddingBottom: 6, borderRadius: 5, borderWidth: 1, borderColor: props.armed?.id === def.id ? '#7dd3fc' : '#3a4f6b', backgroundColor: props.armed?.id === def.id ? '#1d4ed8' : '#16233a' }}>
              <Text fontSize={11} color={props.armed?.id === def.id ? '#ffffff' : '#dbe6f3'} style={{ fontFamily: 'monospace' }}>{def.label}</Text>
            </Box>
          </Pressable>
        ))}
      </Box>
    </Box>
  );
});
