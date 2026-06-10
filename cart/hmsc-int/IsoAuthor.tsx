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
import { Box, Pressable, Scene3D, Text, TextInput } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import { busOn } from '@reactjit/hooks/useIFTTT';
import { GAME_BUILD, GAME_NATIVE_CAMERA } from './game';
import type { BuildFaceSlot, BuildPieceKind, BuildPrefabDef, BuildSkinSet, PlacedBuildPiece, Rect, WorldEvent, WorldGridState } from './game';
import { resolveSnapTarget, modulePitch, SNAP_TUNING_DEFAULTS, type SnapTarget } from './editors/build/snap';
import { pieceVisualShapes, VisualShapeMesh, PlacedPieceMeshes } from './editors/build/pieceMeshes';
import { perfMs, warnPlaceFreeze } from './editors/build/placeFreezeProbe';
import { FacePainter } from './editors/build/FacePainter';
import { BUILD_UI } from './editors/build/buildUi';
import { IsoStage, METERS_PER_LEVEL, type IsoPose } from './isoStage';
import { readRouteTwigState, writeRouteTwigState } from './editors/twigs';
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

// Route id the iso camera pose persists under (editors/twigs) so a hot reload — which
// remounts this component and reconstructs the IsoStage — restores where you were
// looking instead of snapping back to the content centroid. One global pose across
// maps (the pane isn't passed a map stem); the ⌂/F recenter fixes it in one click if
// you open a different map and the saved pose points somewhere stale.
const ISO_ROUTE = '/iso-build';
const ISO_CAM_TWIG = 'camera';

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

// What's armed to place: a single catalog PIECE, a PREFAB (a named composition that
// stamps into many pieces), or the TOWER tool (req_0478: drag a footprint → a hollow
// multi-storey shell). null = nothing armed (pan/select mode).
type Armed = { kind: 'piece' | 'prefab'; id: string } | { kind: 'tower' } | null;

// ── Tower tool (req_0478): skyscrapers without laying every storey by hand ───
// Drag a footprint rectangle → a HOLLOW shell: perimeter walls stacked N floors
// high + a flat roof cap, committed as ONE stamp (one flat-pad lift, one
// building under select/move/clone). Walls are oriented so every FRONT slot
// faces OUTWARD (N=yaw0, E=90, S=180, W=270) — the shell is a clean 6-face box
// for the face painter: 4 exterior sides + roof + interior.
const TOWER_WALL_ID = 'wall.concrete.common';
const TOWER_ROOF_ID = 'roof.flat.common';
const TOWER_MAX_SPAN = 16; // footprint cells per axis (48m at the 3m pitch)
const TOWER_MIN_FLOORS = 1;
const TOWER_MAX_FLOORS = 30;

// The face painter (req_0478 → req_0483) lives in ./editors/build/FacePainter —
// the selection's 6-face paint panel, mounted below when a selection exists.

/** the same tool armed twice = a toggle-off (rail chips re-click to disarm) */
function sameArmed(cur: Armed, next: NonNullable<Armed>): boolean {
  if (!cur || cur.kind !== next.kind) return false;
  if (cur.kind === 'tower' || next.kind === 'tower') return true;
  return cur.id === next.id;
}

export interface IsoAuthorProps {
  // The world to draw UNDER the pieces (terrain + props), same GameState the inspect
  // pane renders — preview==game.
  state: GameState;
  // The standing pieces (the cart's materialized worldStream truth) + the commit the
  // cart already funnels F2 placements through. This pane is just another caller.
  pieces: readonly PlacedBuildPiece[];
  onCommit: (event: WorldEvent, label: string) => void;
  // Batch commit: many events as ONE undoable action with ONE store snapshot. Bulk ops
  // (move/clone/delete a whole building) use this so they don't freeze the editor with
  // a snapshot per piece. Absent (older host) → the pane falls back to per-event onCommit.
  onCommitMany?: (items: ReadonlyArray<{ event: WorldEvent; label: string }>) => void;
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
  // Commit many events as ONE undoable action (one store snapshot) when the host offers
  // it; else fall back to per-event onCommit. Move/clone/delete-building route through
  // this so a big building doesn't freeze on a snapshot-per-piece.
  const commitBatch = useCallback((items: ReadonlyArray<{ event: WorldEvent; label: string }>) => {
    if (!items.length) return;
    if (props.onCommitMany) props.onCommitMany(items);
    else for (const it of items) onCommit(it.event, it.label);
  }, [props.onCommitMany, onCommit]);
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
  // Keyed on the world FIELDS, not `state`: a state-identity tick (physics, HUD)
  // must not cascade into groundTopAt → displayPieces → a full piece re-render
  // (PLACEPERF-0610 — that cascade re-ran the lift + mesh loop every frame).
  const worldGrid = useMemo<WorldGridState>(() => ({
    cellSizeMeters: state.world.cellSizeMeters,
    surfaceRegions: state.world.surfaceRegions as unknown as WorldGridState['surfaceRegions'],
    placedCells: state.world.placedCells as unknown as WorldGridState['placedCells'],
    landforms: (state.world.landforms ?? []) as unknown as WorldGridState['landforms'],
  }), [state.world.cellSizeMeters, state.world.surfaceRegions, state.world.placedCells, state.world.landforms]);
  const groundTopAt = useMemo<(x: number, z: number) => number>(
    () => props.groundTopAt ?? ((x, z) => groundColumnTop(worldGrid, x, z)),
    [props.groundTopAt, worldGrid],
  );
  // What the pane DRAWS and HIT-TESTS: stamped buildings lifted onto the terrain under
  // their footprint (flat pad, req_0444) via the shared idempotent helper the game and
  // compile also use — so the build pane shows pieces exactly where they'll stand, and
  // re-paints the lift when you paint height. Edits keep the RAW `pieces` (piecesRef
  // below): a move/clone commits terrain-agnostic y and the lift re-applies at the new
  // spot — no double-lift, no editor-vs-game drift.
  const displayPieces = useMemo(() => {
    const t0 = perfMs();
    const lifted = GAME_BUILD.placed.liftToTerrain(pieces, groundTopAt);
    warnPlaceFreeze('liftToTerrain', { pieces: pieces.length, ms: perfMs() - t0 });
    return lifted;
  }, [pieces, groundTopAt]);
  const displayPiecesRef = useRef(displayPieces);
  displayPiecesRef.current = displayPieces;

  // The camera controller, seeded centred on what's already built. Pose lives in the
  // ref; JS keeps semantic picking math, while the renderer camera is V23 native.
  const stageRef = useRef<IsoStage | null>(null);
  if (!stageRef.current) {
    // Restore the persisted pose across a hot reload; else open centred on what's built.
    const saved = readRouteTwigState<Partial<IsoPose> | null>(ISO_ROUTE, ISO_CAM_TWIG, null);
    if (saved && Number.isFinite(saved.centerX) && Number.isFinite(saved.centerZ)) {
      stageRef.current = new IsoStage(saved, groundTopAt);
    } else {
      const [cx, cz] = contentCenter(pieces);
      stageRef.current = new IsoStage({ centerX: cx, centerZ: cz, zoom: 1, level: 0 }, groundTopAt);
    }
  }
  const stage = stageRef.current;
  useEffect(() => { stage.setHeightSampler(groundTopAt); }, [stage, groundTopAt]);
  const cameraRef = useRef<any>(null);
  const cameraCtlRef = useRef<ReturnType<typeof GAME_NATIVE_CAMERA.forNode> | null>(null);
  const pushNativeCamera = useCallback(() => {
    cameraCtlRef.current?.setOrbit(stage.nativeOrbitParams());
  }, [stage]);
  const bootCam = useRef(stage.solve()).current;
  useEffect(() => {
    const nodeId = Number(cameraRef.current?.id ?? 0);
    if (!nodeId) {
      console.warn('[iso-author] native camera not engaged — camera node id unavailable');
      return;
    }
    const ctl = GAME_NATIVE_CAMERA.forNode(nodeId);
    cameraCtlRef.current = ctl;
    ctl.setMode('orbit');
    ctl.setSmoothing(0);
    ctl.setOrbit(stage.nativeOrbitParams());
    return () => {
      cameraCtlRef.current = null;
      ctl.disable();
    };
  }, [stage]);
  const [, bump] = useState(0);
  const redraw = useCallback(() => {
    pushNativeCamera();
    bump((n) => (n + 1) & 0xffff);
  }, [pushNativeCamera]);
  // Persist the camera pose at REST points (drag/key release, wheel, button) — never
  // per frame — so a hot reload resumes the view. sculptCamera keeps the same discipline.
  const saveCamera = useCallback(() => { writeRouteTwigState(ISO_ROUTE, ISO_CAM_TWIG, { ...stage.pose }); }, [stage]);
  const recenter = useCallback(() => { const [cx, cz] = contentCenter(piecesRef.current); stage.centerOn(cx, cz); redraw(); saveCamera(); }, [stage, redraw, saveCamera]);

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
  // Default to SINGLE-piece select so you can always grab one piece even when it touches
  // others (the toggle below flips the default; Shift/Alt inverts it for one click). A
  // whole-building select buried single-piece editing — req_0459.
  const [wholeBuilding, setWholeBuilding] = useState(false);
  const wholeBuildingRef = useRef(wholeBuilding);
  wholeBuildingRef.current = wholeBuilding;
  // Shift/Alt held? Mouse events carry no modifier flags here, so track it off the key
  // bus (which does) and read it at click time to invert the select scope.
  const modHeldRef = useRef(false);
  useEffect(() => {
    const upd = (e: any) => { modHeldRef.current = !!(e?.shiftKey || e?.altKey); };
    const offD = busOn('__keydown', upd);
    const offU = busOn('__keyup', upd);
    return () => { offD(); offU(); };
  }, []);
  // An in-progress move drag: the world (dx,dz) the selection is being dragged by on
  // the active level's plane, or null when not moving. Drives the move ghost; the
  // selection re-places (remove+place) on mouse-up.
  const [moveDelta, setMoveDelta] = useState<{ dx: number; dz: number } | null>(null);
  const moveDeltaRef = useRef(moveDelta);
  moveDeltaRef.current = moveDelta;
  // An in-progress drag-paint: the placements a wall LINE or floor RECT would drop,
  // previewed as ghosts and batch-placed on mouse-up. null when not painting.
  type Paint = { pieceId: string; x: number; y: number; z: number; yawDegrees: number };
  const [paintCells, setPaintCells] = useState<Paint[] | null>(null);
  const paintCellsRef = useRef(paintCells);
  paintCellsRef.current = paintCells;
  // The last painted cell-set signature — onMove skips the setPaintCells (and the
  // whole re-render behind it) when the drag is still over the same cells.
  const paintSigRef = useRef('');
  // ── DRAGDRAW profiler (req_0485): the user feels the DRAG lag but the only
  // number printed was the commit-time visualBoxes — nothing measured the drawing
  // itself. This accumulates the whole drag and prints ONE summary line on
  // release, always (not >16ms-gated): per-move event GAPS (a choked engine
  // delays mouse events, so gapMax exposes native frame stalls JS timers can't
  // see directly), the cell recompute cost, the ghost rebuild cost, and the
  // JS render+commit latency behind each setPaintCells.
  type DragPerf = {
    t0: number; lastMoveT: number; moves: number; updates: number; cells: number;
    gapTotal: number; gapMax: number;
    computeTotal: number; computeMax: number;
    ghostTotal: number; ghostMax: number;
    renderTotal: number; renderMax: number; pendingRenderT0: number;
  };
  const dragPerfRef = useRef<DragPerf | null>(null);
  // commitPaint → the standing pieces actually re-rendered (JS side): the
  // "release-to-standing" latency the user perceives as placement time.
  const commitPerfRef = useRef<{ t0: number; label: string } | null>(null);
  useEffect(() => {
    const c = commitPerfRef.current;
    if (!c) return;
    commitPerfRef.current = null;
    console.warn(`[DRAGDRAW] ${c.label} -> standing ms=${(perfMs() - c.t0).toFixed(1)} pieces=${pieces.length}`);
  }, [pieces]);
  // Render+commit latency for each paint-ghost update (effects run after commit,
  // so this captures the React render + reconcile + host mutation flush).
  useEffect(() => {
    const d = dragPerfRef.current;
    if (!d || !d.pendingRenderT0) return;
    const ms = perfMs() - d.pendingRenderT0;
    d.pendingRenderT0 = 0;
    d.renderTotal += ms;
    if (ms > d.renderMax) d.renderMax = ms;
  }, [paintCells]);
  // The save-as-prefab naming prompt: null = closed, else the draft name being typed.
  const [prefabNameDraft, setPrefabNameDraft] = useState<string | null>(null);
  const piecesRef = useRef(pieces);
  piecesRef.current = pieces;
  const rectRef = useRef<Rect>({ x: 0, y: 0, width: 800, height: 600 });
  // Tower tool (req_0478): how many storeys a committed tower stacks, and the live
  // drag's footprint corners (the paint preview shows only the ground ring; the commit
  // expands the full shell from these corners).
  const [towerFloors, setTowerFloors] = useState(8);
  const towerFloorsRef = useRef(towerFloors);
  towerFloorsRef.current = towerFloors;
  const towerDragRef = useRef<{ start: { x: number; z: number }; end: { x: number; z: number } } | null>(null);

  // Placement ground for the ACTIVE floor: terrain at level 0, else the flat slab at the
  // active level's elevation — so raising a floor (▲) drops pieces ON that floor instead
  // of always on the ground. Reads the live pose level, matching the camera target the
  // cursor ray is aimed at (stage.solve targets the same elevation).
  const placeGroundAt = useCallback((x: number, z: number): number => {
    const level = stage.pose.level;
    return level > 0 ? level * METERS_PER_LEVEL : groundTopAt(x, z);
  }, [stage, groundTopAt]);

  // Resolve the cursor to a snap target with the SAME inputs F2 uses (the armed
  // catalog entry's snap mode + size, the ghost yaw, the standing pieces).
  const resolveAt = useCallback((sx: number, sy: number): SnapTarget | null => {
    const a = armedRef.current;
    if (!a) return null;
    // A piece snaps by its own catalog rule (walls edge-snap, etc.); a prefab drops on
    // the grid by its origin — exactly how F2's place() picks snap/size. The tower tool
    // grid-snaps a wall-module footprint (a click drops a 1×1-cell tower).
    const snap = a.kind === 'piece' ? GAME_BUILD.catalog.get(a.id).snap : 'grid';
    const size = a.kind === 'piece'
      ? GAME_BUILD.catalog.get(a.id).size
      : a.kind === 'tower'
        ? GAME_BUILD.catalog.get(TOWER_WALL_ID).size
        : { widthMeters: 1, heightMeters: 3, depthMeters: 1 };
    return resolveSnapTarget({
      ray: stage.pieceRay(sx, sy, rectRef.current),
      pieces: piecesRef.current,
      groundTopAt: placeGroundAt, // active-floor aware → upper-floor placement lands up there
      snap,
      size,
      yawDegrees: ghostYawRef.current,
      tuning: ISO_SNAP_TUNING,
    });
  }, [stage, placeGroundAt]);
  // The per-frame ghost poll (below) reads the latest resolveAt through this ref, so it
  // never snaps against a stale world/terrain after a paint edit.
  const resolveAtRef = useRef(resolveAt);
  resolveAtRef.current = resolveAt;
  const ghostKeyRef = useRef('');

  // Drag-to-build (req_0463): an armed WALL paints a straight line of walls along the
  // drag's dominant axis; an armed FLOOR fills the dragged rectangle with floor tiles.
  // The cell math mirrors resolveSnapTarget exactly (3m module pitch: floors on cell
  // centres, walls run-centred on cells and line-snapped to the 3m edges, yaw 0 along x /
  // 90 along z) so drag-placed pieces land identically to click-placed ones. All cells
  // share ONE base y (terrain under the centroid) so the row/rect reads as a flat pad —
  // matching what liftBuildingsToTerrain does to it after placement.
  const PAINT_MAX_SPAN = 64; // cells per axis — a giant drag can't spawn thousands of pieces
  const paintKindOf = (a: Armed): 'wall' | 'floor' | 'tower' | null => {
    if (!a) return null;
    if (a.kind === 'tower') return 'tower';
    if (a.kind !== 'piece') return null;
    const k = GAME_BUILD.catalog.get(a.id).kind;
    return k === 'wall' || k === 'floor' ? k : null;
  };
  // The tower footprint's perimeter as wall cells, every FRONT facing outward —
  // shared by the drag preview (ground ring only) and the commit (all storeys).
  const towerRing = (start: { x: number; z: number }, end: { x: number; z: number }) => {
    const pitch = modulePitch(GAME_BUILD.catalog.get(TOWER_WALL_ID).size.widthMeters, 1);
    const cellOf = (v: number) => Math.floor(v / pitch);
    const center = (c: number) => (c + 0.5) * pitch;
    const span = (a0: number, b0: number): [number, number] => { const lo = Math.min(a0, b0), hi = Math.max(a0, b0); return [lo, Math.min(hi, lo + TOWER_MAX_SPAN - 1)]; };
    const [x0, x1] = span(cellOf(start.x), cellOf(end.x));
    const [z0, z1] = span(cellOf(start.z), cellOf(end.z));
    const cells: { x: number; z: number; yaw: number }[] = [];
    for (let cx = x0; cx <= x1; cx += 1) {
      cells.push({ x: center(cx), z: z0 * pitch, yaw: 180 });       // south face, front out (−z)
      cells.push({ x: center(cx), z: (z1 + 1) * pitch, yaw: 0 });   // north face, front out (+z)
    }
    for (let cz = z0; cz <= z1; cz += 1) {
      cells.push({ x: x0 * pitch, z: center(cz), yaw: 270 });       // west face, front out (−x)
      cells.push({ x: (x1 + 1) * pitch, z: center(cz), yaw: 90 });  // east face, front out (+x)
    }
    return { cells, x0, x1, z0, z1, pitch, center };
  };
  const computePaint = useCallback((a: Armed, start: { x: number; z: number }, end: { x: number; z: number }): Paint[] => {
    const kind = paintKindOf(a);
    if (!kind || !a) return [];
    if (kind === 'tower') {
      // Preview the GROUND RING only (a 16-cell × 30-floor shell would re-ghost
      // thousands of meshes per mouse-move); the commit stacks the full storeys.
      towerDragRef.current = { start, end };
      const ring = towerRing(start, end);
      const y = placeGroundAt(((ring.x0 + ring.x1 + 1) / 2) * ring.pitch, ((ring.z0 + ring.z1 + 1) / 2) * ring.pitch);
      return ring.cells.map((c) => ({ pieceId: TOWER_WALL_ID, x: c.x, y, z: c.z, yawDegrees: c.yaw }));
    }
    if (a.kind !== 'piece') return [];
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
      // wall: the longer drag axis is the run; the short axis pins to the nearest 3m edge
      const dx = Math.abs(end.x - start.x), dz = Math.abs(end.z - start.z);
      if (dx >= dz) {
        const lineZ = Math.round(start.z / pitch) * pitch;
        const [c0, c1] = range(cellOf(start.x), cellOf(end.x));
        for (let cx = c0; cx <= c1; cx += 1) cells.push({ x: center(cx), z: lineZ, yaw: 0 });
      } else {
        const lineX = Math.round(start.x / pitch) * pitch;
        const [c0, c1] = range(cellOf(start.z), cellOf(end.z));
        for (let cz = c0; cz <= c1; cz += 1) cells.push({ x: lineX, z: center(cz), yaw: 90 });
      }
    }
    if (!cells.length) return [];
    let sx = 0, sz = 0;
    for (const c of cells) { sx += c.x; sz += c.z; }
    const y = placeGroundAt(sx / cells.length, sz / cells.length); // one flat-pad base on the active floor
    return cells.map((c) => ({ pieceId: def.id, x: c.x, y, z: c.z, yawDegrees: c.yaw }));
  }, [placeGroundAt]);
  const computePaintRef = useRef(computePaint);
  computePaintRef.current = computePaint;
  // Commit a tower (req_0478): the full hollow shell — perimeter walls stacked
  // towerFloors high + a flat roof cap over the footprint — as ONE stamp (one
  // undo step, one flat-pad lift group, one building under select/move/clone).
  const commitTower = (start: { x: number; z: number }, end: { x: number; z: number }) => {
    const floors = Math.max(TOWER_MIN_FLOORS, Math.min(TOWER_MAX_FLOORS, towerFloorsRef.current));
    const ring = towerRing(start, end);
    const baseY = placeGroundAt(((ring.x0 + ring.x1 + 1) / 2) * ring.pitch, ((ring.z0 + ring.z1 + 1) / 2) * ring.pitch);
    const wallH = GAME_BUILD.catalog.get(TOWER_WALL_ID).size.heightMeters;
    const stampId = `tower-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    const placements: (Paint & { stampId: string })[] = [];
    for (let f = 0; f < floors; f += 1) {
      for (const c of ring.cells) placements.push({ pieceId: TOWER_WALL_ID, x: c.x, y: baseY + f * wallH, z: c.z, yawDegrees: c.yaw, stampId });
    }
    for (let cx = ring.x0; cx <= ring.x1; cx += 1) {
      for (let cz = ring.z0; cz <= ring.z1; cz += 1) {
        placements.push({ pieceId: TOWER_ROOF_ID, x: ring.center(cx), y: baseY + floors * wallH, z: ring.center(cz), yawDegrees: 0, stampId });
      }
    }
    const valid = placements.filter((p) => GAME_BUILD.placed.validatePlacement(p).length === 0);
    if (!valid.length) return;
    const w = ring.x1 - ring.x0 + 1;
    const d = ring.z1 - ring.z0 + 1;
    commitBatch(valid.map((p) => ({ event: { kind: 'piecePlaced', placement: p } as WorldEvent, label: `tower ${w}×${d}×${floors}F` })));
  };

  // Pointer. A DRAG rotates the view (yaw from horizontal motion — WASD does the
  // panning). A CLICK (no drag) acts at the cursor: place the armed piece, or select
  // the piece under it. Place/select fire on mouse-UP so a rotate-drag never drops a
  // piece; click vs drag is told by travel (>4px = a turn).
  // A drag is one of two gestures, fixed at mouse-down: ROTATE the view (the default,
  // on empty ground), or MOVE the selection (when the press lands on an
  // already-selected piece and nothing's armed). gx0/gz0 hold the down point on the
  // active plane so a move tracks the cursor's world delta, not pixels.
  const dragRef = useRef<{ x: number; x0: number; y0: number; turned: boolean; mode: 'rotate' | 'move' | 'paint'; gx0: number; gz0: number } | null>(null);
  const local = (e: any): { x: number; y: number } => {
    const r = rectRef.current;
    return { x: Number(e?.x ?? 0) - r.x, y: Number(e?.y ?? 0) - r.y };
  };

  const onDown = (e: any) => {
    props.onFocus?.();
    const p = local(e);
    let mode: 'rotate' | 'move' | 'paint' = 'rotate';
    let gx0 = 0, gz0 = 0;
    if (armedRef.current && paintKindOf(armedRef.current)) {
      // armed with a wall/floor → a drag PAINTS a line/rect; record the start ground point
      const g = stage.groundPoint(p.x, p.y, rectRef.current);
      if (g) { mode = 'paint'; gx0 = g.x; gz0 = g.z; }
    } else if (!armedRef.current && selectedIdsRef.current.size) {
      // Grab a selected piece to move it: the press raycasts onto a piece already in the
      // selection (VISIBLE drawn pieces so the grab matches the screen). Else → rotate.
      const hit = GAME_BUILD.placed.raycast(stage.pieceRay(p.x, p.y, rectRef.current), visiblePiecesRef.current, ISO_SNAP_TUNING.reachMeters);
      if (hit && selectedIdsRef.current.has(hit.piece.id)) {
        const g = stage.groundPoint(p.x, p.y, rectRef.current);
        if (g) { mode = 'move'; gx0 = g.x; gz0 = g.z; }
      }
    }
    dragRef.current = { x: p.x, x0: p.x, y0: p.y, turned: false, mode, gx0, gz0 };
    paintSigRef.current = '';
    if (mode === 'paint') {
      const now = perfMs();
      dragPerfRef.current = {
        t0: now, lastMoveT: now, moves: 0, updates: 0, cells: 0,
        gapTotal: 0, gapMax: 0, computeTotal: 0, computeMax: 0,
        ghostTotal: 0, ghostMax: 0, renderTotal: 0, renderMax: 0, pendingRenderT0: 0,
      };
    }
    if (armedRef.current) setSnap(resolveAt(p.x, p.y));
  };
  const onMove = (e: any) => {
    const p = local(e);
    const d = dragRef.current;
    if (d && Math.abs(p.x - d.x0) + Math.abs(p.y - d.y0) > 4) {
      d.turned = true;
      if (d.mode === 'paint') {
        const perf = dragPerfRef.current;
        const now = perfMs();
        if (perf) {
          const gap = now - perf.lastMoveT;
          perf.lastMoveT = now;
          perf.moves += 1;
          perf.gapTotal += gap;
          if (gap > perf.gapMax) perf.gapMax = gap;
        }
        const g = stage.groundPoint(p.x, p.y, rectRef.current);
        if (g) {
          // Re-render the paint ghosts ONLY when the dragged-to CELL SET changes
          // (the hover ghost's ghostKeyRef discipline, applied to the paint drag):
          // raw mouse-moves inside the same cell used to push a fresh cells array
          // every event → a full re-render + ghost rebuild per move — the rest of
          // the drag-draw lag. The signature (count + first/last cell + base y)
          // uniquely names a line/rect/ring, so same cells → no state change.
          const t0 = perfMs();
          const cells = computePaintRef.current(armedRef.current, { x: d.gx0, z: d.gz0 }, g);
          const computeMs = perfMs() - t0;
          const head = cells[0];
          const tail = cells[cells.length - 1];
          const sig = head ? `${cells.length}|${head.x},${head.y},${head.z},${head.yawDegrees}|${tail.x},${tail.z}` : '';
          warnPlaceFreeze('paintCompute', { cells: cells.length, ms: computeMs });
          if (perf) {
            perf.computeTotal += computeMs;
            if (computeMs > perf.computeMax) perf.computeMax = computeMs;
            perf.cells = cells.length;
          }
          if (sig !== paintSigRef.current) {
            paintSigRef.current = sig;
            if (perf) { perf.updates += 1; perf.pendingRenderT0 = perfMs(); }
            setPaintCells(cells);
          }
        }
      } else if (d.mode === 'move') {
        const g = stage.groundPoint(p.x, p.y, rectRef.current);
        // Snap the drag delta to whole grid cells so a moved piece stays grid-locked —
        // the pieces start grid-aligned, so a whole-cell shift keeps them aligned and
        // anything built onto them lines up. cellSizeMeters is the build grid pitch.
        if (g) {
          const cs = state.world.cellSizeMeters || 1;
          const dx = Math.round((g.x - d.gx0) / cs) * cs;
          const dz = Math.round((g.z - d.gz0) / cs) * cs;
          // Only update when the SNAPPED delta actually changes (req_0503):
          // a fresh {dx,dz} per raw mouse event re-rendered the whole pane +
          // rebuilt the 179-piece move ghost even while the drag sat inside
          // one cell — the same no-op-update class the paint drag had.
          const cur = moveDeltaRef.current;
          if (!cur || cur.dx !== dx || cur.dz !== dz) setMoveDelta({ dx, dz });
        }
      } else {
        stage.rotateBy((p.x - d.x) * 0.3); // horizontal drag → yaw
        d.x = p.x;
        pushNativeCamera();
      }
      return;
    }
    if (armedRef.current) setSnap(resolveAt(p.x, p.y));
  };
  const onUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    // The drag-draw summary — printed for EVERY paint drag (the proof line, not
    // >16ms-gated). gapMax is the longest stall between mouse events: when the
    // engine's frame chokes, events arrive late, so this is where native lag
    // shows up even though JS-side compute/render read low.
    const perf = dragPerfRef.current;
    dragPerfRef.current = null;
    if (perf && d.mode === 'paint' && perf.moves > 0) {
      const avg = (total: number, n: number) => (n > 0 ? (total / n).toFixed(1) : '0');
      console.warn(
        `[DRAGDRAW] drag ms=${(perfMs() - perf.t0).toFixed(0)} moves=${perf.moves} updates=${perf.updates} cells=${perf.cells}`
        + ` | gap avg=${avg(perf.gapTotal, perf.moves)} max=${perf.gapMax.toFixed(1)}`
        + ` | compute avg=${avg(perf.computeTotal, perf.moves)} max=${perf.computeMax.toFixed(1)}`
        + ` | ghost avg=${avg(perf.ghostTotal, perf.updates)} max=${perf.ghostMax.toFixed(1)}`
        + ` | render avg=${avg(perf.renderTotal, perf.updates)} max=${perf.renderMax.toFixed(1)}`,
      );
    }
    if (d.turned) {
      if (d.mode === 'move') commitMove();
      else if (d.mode === 'paint') commitPaint();
      else saveCamera(); // a rotate settled — persist the new yaw
      return;
    }
    // No travel → a click: place the armed piece, or (re)select under the cursor.
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
    if (a.kind === 'tower') {
      // A click (no drag) drops the smallest tower: a 1×1-cell footprint shell.
      const p = { x: t.placement.x, z: t.placement.z };
      commitTower(p, p);
      return;
    }
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
    // Hit-test the VISIBLE (terrain-lifted, cut-away-filtered) pieces so a click
    // lands on what's on screen — a hidden upper floor can't shadow the click.
    const hit = GAME_BUILD.placed.raycast(stage.pieceRay(sx, sy, rectRef.current), visiblePiecesRef.current, ISO_SNAP_TUNING.reachMeters);
    if (!hit) { setSelectedIds(new Set()); return; }
    // The toggle sets the default scope; Shift/Alt inverts it for this click. So a single
    // piece is always one click away (even touching others), and the whole building is one
    // modifier away — no need to flip the toggle to edit one piece. The connected
    // walk spans the FULL piece set (hidden floors included) so grabbing a
    // building grabs ALL of it — a move never tears off the cut-away storeys.
    const whole = wholeBuildingRef.current !== modHeldRef.current;
    setSelectedIds(whole ? GAME_BUILD.placed.connected(hit.piece.id, displayPiecesRef.current) : new Set([hit.piece.id]));
  };
  // Remove every selected piece (one pieceRemoved each, the SAME event F2's X commits).
  const deleteSelected = () => {
    const ids = [...selectedIdsRef.current];
    if (!ids.length) return;
    commitBatch(ids.map((id) => ({ event: { kind: 'pieceRemoved', id } as WorldEvent, label: `removed ${id}` })));
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
    // Spread the whole piece (minus the stream-minted id) so each copy keeps its per-face
    // skin/materials and any wall edit — only the X position shifts. Give the WHOLE clone
    // one fresh stampId: that makes the copy its own independent building (so it gets the
    // flat-pad terrain lift as a unit) instead of a phantom member of the original's stamp.
    // One batch → one undo step, one snapshot.
    const cloneStampId = `clone-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    commitBatch(sel.map((p) => { const { id, ...rest } = p; return { event: { kind: 'piecePlaced', placement: { ...rest, x: p.x + dx, stampId: cloneStampId } } as WorldEvent, label: `cloned ${p.pieceId}` }; }));
  };
  // The default name offered in the save prompt: the next free "Custom N".
  const nextCustomName = () => `Custom ${prefabs.filter((d) => /^Custom\b/.test(d.label)).length + 1}`;
  // Save the current selection as a reusable PREFAB (USER ASK): build an origin-relative
  // BuildPrefabDef from the selected pieces (prefabFromPieces keeps each piece's skin +
  // wall edit) and register it with a prefabDefined event — the SAME stream the cart
  // merges into the prefabs rail, so it shows up there immediately to stamp again. The
  // name comes from the save prompt (falls back to "Custom N" if left blank).
  const saveSelectionAsPrefab = (name: string) => {
    const sel = piecesRef.current.filter((p) => selectedIdsRef.current.has(p.id));
    if (!sel.length) return;
    const label = name.trim() || nextCustomName();
    const id = GAME_BUILD.placed.mintPrefabId(label);
    const theme = GAME_BUILD.catalog.get(sel[0].pieceId).theme;
    const def = GAME_BUILD.placed.prefabFromPieces(id, label, theme, sel);
    onCommit({ kind: 'prefabDefined', def }, `saved prefab ${label}`);
  };
  // Commit a finished move drag: shift every selected piece by the dragged world delta.
  // There's no pieceMoved event (that'd touch the shared stream + F2 + compile) — a move
  // IS a remove of the old id + a place at the new spot, the SAME two events delete/clone
  // already emit. Validate all destinations FIRST (intrinsic checks; not collision) and
  // abort the whole move if any is refused, so a building never lands half-shifted. The
  // selection re-keys to fresh stream ids, so the old highlight just clears.
  const commitMove = () => {
    const delta = moveDeltaRef.current;
    setMoveDelta(null);
    if (!delta || (Math.abs(delta.dx) < 1e-3 && Math.abs(delta.dz) < 1e-3)) return;
    const sel = piecesRef.current.filter((p) => selectedIdsRef.current.has(p.id));
    if (!sel.length) return;
    // Spread the WHOLE piece (minus the stream-minted id) into the new placement so the
    // moved instance keeps its per-face skin/materials, wall edit, and prefab grouping —
    // only x/z shift. (The earlier slice copied just pieceId/pose, which stripped every
    // face material on move.)
    const moves = sel.map((p) => { const { id, ...rest } = p; return { id, placement: { ...rest, x: p.x + delta.dx, z: p.z + delta.dz } }; });
    if (moves.some((m) => GAME_BUILD.placed.validatePlacement(m.placement).length > 0)) return;
    // Release-to-standing latency for MOVES too (req_0502 — the user stopwatched
    // a move at 3s while the commit probes read ~120ms; this brackets the gap).
    commitPerfRef.current = { t0: perfMs(), label: `move commit (${sel.length} pieces)` };
    // One batch: all removes then all places (the SAME two events delete/clone emit) →
    // one undo step, one store snapshot, so moving a whole building doesn't freeze.
    commitBatch([
      ...moves.map((m) => ({ event: { kind: 'pieceRemoved', id: m.id } as WorldEvent, label: `moved ${m.id}` })),
      ...moves.map((m) => ({ event: { kind: 'piecePlaced', placement: m.placement } as WorldEvent, label: `moved ${m.placement.pieceId}` })),
    ]);
    setSelectedIds(new Set());
  };
  // Commit a finished drag-paint: drop the previewed wall line / floor rect as ONE batch
  // (one undo step, one snapshot). Skip any cell the validator refuses so a partial run
  // still lands the valid pieces.
  const commitPaint = () => {
    const cells = paintCellsRef.current;
    setPaintCells(null);
    const a = armedRef.current;
    // Release-to-standing latency: the commitPerf effect prints when the pieces
    // prop reflects the commit (store snapshot + stream materialize + re-render).
    commitPerfRef.current = { t0: perfMs(), label: a?.kind === 'tower' ? 'tower commit' : 'paint commit' };
    if (a?.kind === 'tower') {
      // The preview showed the ground ring; commit the FULL shell from the drag corners.
      const rect = towerDragRef.current;
      towerDragRef.current = null;
      if (rect) commitTower(rect.start, rect.end);
      return;
    }
    if (!cells || !cells.length) { commitPerfRef.current = null; return; }
    const valid = cells.filter((c) => GAME_BUILD.placed.validatePlacement(c).length === 0);
    if (!valid.length) { commitPerfRef.current = null; return; }
    const label = a && a.kind === 'piece' ? GAME_BUILD.catalog.get(a.id).label : 'piece';
    commitBatch(valid.map((c) => ({ event: { kind: 'piecePlaced', placement: c } as WorldEvent, label: `painted ${label}` })));
  };
  // Latest delete/clone closures, so the once-mounted key listener always calls the
  // current ones (they read live refs + the current onCommit).
  const keyActionsRef = useRef({ deleteSelected, cloneSelected, recenter, saveCamera });
  keyActionsRef.current = { deleteSelected, cloneSelected, recenter, saveCamera };

  // Keys (while focused): R rotates the ghost, Q/E turn the view, Delete/Backspace
  // removes the selection, Esc disarms / clears the selection.
  useEffect(() => {
    if (!props.focused) return;
    const off = busOn('__keydown', (e: any) => {
      const k = String(e?.key ?? '').toLowerCase();
      if (k === 'r') setGhostYaw((y) => (y + 90) % 360);
      else if (k === 'escape') { setArmed(null); setSelectedIds(new Set()); }
      else if (k === 'q') { stage.rotate(-1); pushNativeCamera(); keyActionsRef.current.saveCamera(); }
      else if (k === 'e') { stage.rotate(1); pushNativeCamera(); keyActionsRef.current.saveCamera(); }
      else if (k === 'f' || k === 'home') keyActionsRef.current.recenter();
      else if (k === 'delete' || k === 'backspace') keyActionsRef.current.deleteSelected();
    });
    return off;
  }, [props.focused, stage, pushNativeCamera]);

  // WASD / arrow keys slide the view across the ground (held-key pan loop). Speed
  // scales with the eye distance so a keystroke crosses the same fraction of the view
  // at every zoom. The loop only runs while this pane is focused.
  useEffect(() => {
    if (!props.focused) return;
    const held: Record<string, boolean> = {};
    const key = (e: any): string => { const k = String(e?.key ?? '').toLowerCase(); return ARROW_TO_WASD[k] ?? k; };
    const offD = busOn('__keydown', (e: any) => { const k = key(e); if (MOVE_KEYS.has(k)) held[k] = true; });
    const offU = busOn('__keyup', (e: any) => { const k = key(e); if (MOVE_KEYS.has(k)) { held[k] = false; keyActionsRef.current.saveCamera(); } });
    const G: any = globalThis;
    const sched = G.requestAnimationFrame ? G.requestAnimationFrame.bind(G) : (fn: any) => setTimeout(fn, 16);
    const cancel = G.cancelAnimationFrame ? G.cancelAnimationFrame.bind(G) : clearTimeout;
    let handle: any = 0;
    let last = G.performance?.now?.() ?? 0;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const now = G.performance?.now?.() ?? last + 16;
      // Frame-stall watchdog (req_0502): this loop reschedules itself every
      // frame, so a long gap between ticks IS a main-thread stall — JS work we
      // haven't probed, or the host frame choking — exactly the time the
      // commit probes can't see. One line per stall, with what it followed.
      if (now - last > 150) {
        console.warn(`[DRAGDRAW] frame stall ms=${(now - last).toFixed(0)}${commitPerfRef.current ? ` after=${commitPerfRef.current.label}` : ''}`);
      }
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
      // Not during a live paint drag: the paint ghosts own the preview there, and
      // this per-frame resolve + setSnap was re-rendering the whole pane every
      // frame UNDER the drag — part of the drag-draw lag.
      if (armedRef.current && dragRef.current?.mode !== 'paint') {
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

  const level = stage.pose.level;

  // The placement ghost: the armed piece drawn translucent at the snapped pose,
  // tinted blocked-red when validatePlacement refuses it — F2's ghost, in iso.
  const ghostMeshes = useMemo(() => {
    const a = armedRef.current;
    if (!a || !snap) return null;
    if (paintCells && paintCells.length) return null; // the paint line/rect ghost owns the preview
    if (a.kind === 'tower') {
      // Hover-preview ONE wall module at the snapped cell (the full ring ghosts
      // on drag via the paint preview; a whole-shell hover ghost would thrash).
      const w = { pieceId: TOWER_WALL_ID, x: snap.placement.x, y: snap.placement.y, z: snap.placement.z, yawDegrees: 0 };
      return pieceVisualShapes(w, 'isoGhostTower', [{ id: 'isoGhostTower', ...w }]).map((shape) => (
        <VisualShapeMesh key={shape.kind === 'ramp' ? shape.ramp.key : shape.box.key} shape={shape} colorOverride={BUILD_UI.ghostColor} opacityOverride={BUILD_UI.ghostOpacity} />
      ));
    }
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
    const supportPieces = [...displayPieces, ...previews.map((p, i) => ({ id: `isoGhost${i}`, ...p }))];
    return previews.flatMap((p, i) => pieceVisualShapes(p, `isoGhost${i}`, supportPieces).map((shape) => (
      <VisualShapeMesh key={shape.kind === 'ramp' ? shape.ramp.key : shape.box.key} shape={shape} colorOverride={color} opacityOverride={BUILD_UI.ghostOpacity} />
    )));
  }, [snap, armed, prefabById, paintCells, displayPieces]);

  // The move preview: the selected pieces drawn translucent at the dragged offset while
  // a move drag is live, tinted blocked-red if any destination fails validation — the
  // same ghost language placement uses, so a move reads like a re-place.
  const moveGhostMeshes = useMemo(() => {
    if (!moveDelta) return null;
    // Preview from the DRAWN (terrain-lifted) pieces so the ghost rides the terrain where
    // the building currently stands; the committed move re-lifts at the drop spot.
    const sel = displayPieces.filter((p) => selectedIds.has(p.id));
    if (!sel.length) return null;
    const moved = sel.map((p) => ({ pieceId: p.pieceId, x: p.x + moveDelta.dx, y: p.y, z: p.z + moveDelta.dz, yawDegrees: p.yawDegrees }));
    const blocked = moved.some((m) => GAME_BUILD.placed.validatePlacement(m as any).length > 0);
    const color = blocked ? BUILD_UI.ghostBlockedColor : BUILD_UI.ghostColor;
    const supportPieces = [
      ...displayPieces.filter((p) => !selectedIds.has(p.id)),
      ...moved.map((m, i) => ({ id: `isoMove${i}`, ...m })),
    ];
    return moved.flatMap((m, i) => pieceVisualShapes(m, `isoMove${i}`, supportPieces).map((shape) => (
      <VisualShapeMesh key={shape.kind === 'ramp' ? shape.ramp.key : shape.box.key} shape={shape} colorOverride={color} opacityOverride={BUILD_UI.ghostOpacity} />
    )));
  }, [moveDelta, displayPieces, selectedIds]);

  // The drag-paint preview: every wall in the line / floor in the rect drawn translucent,
  // each tinted blocked-red if the validator refuses it.
  const paintGhostMeshes = useMemo(() => {
    if (!paintCells || !paintCells.length) return null;
    const t0 = perfMs();
    // ONE support array shared by every cell (PLACEPERF-0610): pieceGridOf caches
    // the spatial grid on the pieces ARRAY identity, so building this inside the
    // flatMap (a fresh array per cell) forced an O(N) grid rebuild per cell, per
    // mouse-move — the drag-draw lag. Hoisted, all cells share one cached grid.
    const supportPieces = [...displayPieces, ...paintCells.map((p, j) => ({ id: `isoPaint${j}`, ...p }))];
    const ghosts = paintCells.flatMap((c, i) => {
      const color = GAME_BUILD.placed.validatePlacement(c).length > 0 ? BUILD_UI.ghostBlockedColor : BUILD_UI.ghostColor;
      return pieceVisualShapes(c, `isoPaint${i}`, supportPieces).map((shape) => (
        <VisualShapeMesh key={shape.kind === 'ramp' ? shape.ramp.key : shape.box.key} shape={shape} colorOverride={color} opacityOverride={BUILD_UI.ghostOpacity} />
      ));
    });
    const ghostMs = perfMs() - t0;
    warnPlaceFreeze('paintGhost', { cells: paintCells.length, pieces: displayPieces.length, ms: ghostMs });
    const perf = dragPerfRef.current;
    if (perf) {
      perf.ghostTotal += ghostMs;
      if (ghostMs > perf.ghostMax) perf.ghostMax = ghostMs;
    }
    return ghosts;
  }, [paintCells, displayPieces]);

  const noIds = useMemo(() => new Set<string>(), []);

  // Cut-away walls: HIDE every piece that sits ABOVE the active floor so you can
  // see (and build) into the storey you're editing — the Sims "view this level"
  // move, tied to the floor selector. Hidden, not faded (req_0504): under the
  // instanced city renderer a faded piece falls out of the instance buckets to
  // an individual translucent mesh, and "everything above floor 0" would
  // re-create the per-piece node storm the instancing just removed. Raycasts
  // pick from this same visible list, so you can't grab what you can't see.
  const visiblePieces = useMemo(() => {
    const cut = (level + 1) * METERS_PER_LEVEL - 0.01;
    const visible = displayPieces.filter((p) => p.y < cut);
    return visible.length === displayPieces.length ? displayPieces : visible;
  }, [displayPieces, level]);
  const visiblePiecesRef = useRef(visiblePieces);
  visiblePiecesRef.current = visiblePieces;

  // Memoize the STATIC scene content — the world meshes (terrain/landforms/props) and
  // the texture-capture mounts — so a camera-only redraw doesn't re-run and reconcile
  // the whole world every tick. Drag-rotate fires a redraw per mouse-move; without this
  // a 360° spin re-built the entire terrain/landform/prop tree dozens of times a second
  // and choked. Only a real world/skin change rebuilds these; camera + grid + pieces +
  // ghost stay live below.
  const worldStatics = useMemo(() => (
    <WorldStatics world={state.world} skyConfig={state.config.sky} />
  ), [state.world, state.config.sky]);
  const sceneCaptures = useMemo(() => (
    <>
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
    </>
  ), [state.world.landforms, state.world.props, skinIds, state.player.perception]);

  return (
    <Box
      onLayout={(lr: any) => { rectRef.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height }; }}
      style={{ width: '100%', height: '100%', position: 'relative' }}
    >
      {sceneCaptures}
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#0a1018" showAxes={false}>
        <Scene3D.Camera nativeCamera ref={cameraRef} position={bootCam.pos} target={bootCam.target} fov={bootCam.fov} far={FAR_CLIP} />
        <Scene3D.Fog enabled={false} />
        {worldStatics}
        {/* the build grid on the active floor (Scene3D's showGrid is a no-op — we draw
            our own tile lines, world-anchored, following the camera) */}
        <IsoGrid centerX={stage.pose.centerX} centerZ={stage.pose.centerZ} level={level} distance={stage.distance()} />
        {/* the standing city — the SAME renderer F2 uses (instanced buckets);
            selection highlighted, floors above the active level HIDDEN (cut-away) */}
        <PlacedPieceMeshes pieces={visiblePieces} markedIds={selectedIds} targetId={null} occludedIds={noIds} />
        {ghostMeshes}
        {moveGhostMeshes}
        {paintGhostMeshes}
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
          // The scroll event carries scrollX/scrollY/deltaX/deltaY — NOT x/y — so
          // local(e) would read 0 for the cursor and anchor the zoom at a far
          // off-screen pixel (the view lurched up-left by a huge amount). Read the
          // real cursor from the engine like the ghost poll does; fall back to the
          // pane centre so a zoom with no cursor info still behaves.
          const G: any = globalThis;
          const r = rectRef.current;
          const mx = Number(G.getMouseX?.() ?? (r.x + r.width / 2));
          const my = Number(G.getMouseY?.() ?? (r.y + r.height / 2));
          stage.zoomToCursor(mx - r.x, my - r.y, d > 0 ? 1.15 : 1 / 1.15, r);
          redraw();
          saveCamera();
        }}
        style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#00000001' }}
      />

      {/* ── Sims control cluster (top-right): rotate · zoom · floor ────────── */}
      <Box style={{ position: 'absolute', right: 8, top: 8, flexDirection: 'row', gap: 4 }}>
        <IsoBtn label="⌂" title="Recenter on what's built (F)" onPress={recenter} />
        <IsoBtn label="⟲" title="Rotate view 90° left (Q)" onPress={() => { stage.rotate(-1); pushNativeCamera(); saveCamera(); }} />
        <IsoBtn label="⟳" title="Rotate view 90° right (E)" onPress={() => { stage.rotate(1); pushNativeCamera(); saveCamera(); }} />
        <IsoBtn label="−" title="Zoom out" onPress={() => { stage.zoomBy(1 / 1.25); redraw(); saveCamera(); }} />
        <IsoBtn label="+" title="Zoom in" onPress={() => { stage.zoomBy(1.25); redraw(); saveCamera(); }} />
        <IsoBtn label="▼" title="Floor down a storey" onPress={() => { stage.lowerLevel(); redraw(); saveCamera(); }} />
        <Box style={{ paddingLeft: 6, paddingRight: 6, paddingTop: 4, paddingBottom: 4, backgroundColor: BUILD_UI.panelBg, borderRadius: 4 }}>
          <Text fontSize={10} color="#cbd5e1" style={{ fontFamily: 'monospace' }}>{`F${level}`}</Text>
        </Box>
        <IsoBtn label="▲" title="Floor up a storey" onPress={() => { stage.raiseLevel(); redraw(); saveCamera(); }} />
        <IsoBtn label={wholeBuilding ? '▦' : '▪'} title={wholeBuilding ? 'Select: whole building · Shift-click = one piece' : 'Select: one piece · Shift-click = whole building'} onPress={() => setWholeBuilding((v) => !v)} />
        {selectedIds.size > 0 ? (
          <>
            <IsoBtn label="⊞" title="Save selection as a prefab" onPress={() => setPrefabNameDraft(nextCustomName())} />
            <IsoBtn label="⧉" title="Clone selection" onPress={cloneSelected} />
            <IsoBtn label="✕" title="Delete selection (Del)" onPress={deleteSelected} />
          </>
        ) : null}
      </Box>

      {/* ── tower floors (req_0478): how high the next dragged tower stacks ── */}
      {armed?.kind === 'tower' ? (
        <Box style={{ position: 'absolute', right: 8, top: 36, flexDirection: 'row', gap: 4, alignItems: 'center' }}>
          <IsoBtn label="−" title="Fewer floors" onPress={() => setTowerFloors((n) => Math.max(TOWER_MIN_FLOORS, n - 1))} />
          <Box style={{ paddingLeft: 6, paddingRight: 6, paddingTop: 4, paddingBottom: 4, backgroundColor: BUILD_UI.panelBg, borderRadius: 4 }}>
            <Text fontSize={10} color="#cbd5e1" style={{ fontFamily: 'monospace' }}>{`${towerFloors} floors`}</Text>
          </Box>
          <IsoBtn label="+" title="More floors" onPress={() => setTowerFloors((n) => Math.min(TOWER_MAX_FLOORS, n + 1))} />
        </Box>
      ) : null}

      {/* ── face painter (req_0478 → req_0483): paint the selection's 6 faces —
          the panel module owns the brush, material navigation, and slot math ── */}
      {selectedIds.size > 0 && !armed ? (
        <FacePainter pieces={pieces} selectedIds={selectedIds} commitBatch={commitBatch} />
      ) : null}

      {/* ── catalog rail (bottom): pick a piece to place ───────────────────── */}
      <CatalogRail prefabs={prefabs} armed={armed} onArm={(a) => { setArmed((cur) => (sameArmed(cur, a) ? null : a)); setSelectedIds(new Set()); }} />

      <Text fontSize={9} color={props.focused ? '#7dd3fc' : '#475569'} style={{ fontFamily: 'monospace', position: 'absolute', left: 8, top: 34 }}>
        {armed
          ? armed.kind === 'tower'
            ? `tower: drag the footprint · ${towerFloors} floors (+/− top right) · hollow shell + roof, one building · Esc`
            : `place: ${(armed.kind === 'prefab' ? prefabById.get(armed.id)?.label ?? armed.id : GAME_BUILD.catalog.get(armed.id).label)} · click to place${paintKindOf(armed) === 'wall' ? ' · drag = wall line' : paintKindOf(armed) === 'floor' ? ' · drag = floor area' : ' · drag rotate'} · R rotate · Esc`
          : selectedIds.size > 0
            ? `${selectedIds.size} selected · drag to move · paint faces (top right) · ⧉ clone · ✕/Del remove · ${wholeBuilding ? 'building' : 'one piece'} (shift inverts)`
            : `WASD pan · drag rotate · scroll zoom · F recenter · click = ${wholeBuilding ? 'building, shift = piece' : 'piece, shift = building'} · pick below to build`}
      </Text>
      {/* what's in the map — the "junk" is the real placed pieces + world props (the
          same content F2/the game shows); ones off the painted chunk float over sky */}
      <Text fontSize={9} color="#64748b" style={{ fontFamily: 'monospace', position: 'absolute', left: 8, top: 48 }}>
        {`${pieces.length} pieces · ${state.world.props?.length ?? 0} props`}
      </Text>

      {/* Save-as-prefab name prompt — rendered as the root's LAST child (full-area
          overlay) so it sits on top and owns clicks while open. */}
      {prefabNameDraft !== null ? (
        <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00000099' }}>
          <Box style={{ width: 300, backgroundColor: '#0b1220', borderWidth: 1, borderColor: '#1e3a5f', borderRadius: 8, padding: 14, gap: 10 }}>
            <Text fontSize={12} color="#7dd3fc" style={{ fontFamily: 'monospace', fontWeight: 700 }}>Name this prefab</Text>
            <TextInput
              text={prefabNameDraft}
              onChangeText={(v: string) => setPrefabNameDraft(v)}
              style={{ backgroundColor: '#0f1a2e', borderWidth: 1, borderColor: '#27364a', borderRadius: 4, paddingLeft: 8, paddingRight: 8, paddingTop: 6, paddingBottom: 6, color: '#e2e8f0', fontSize: 13, fontFamily: 'monospace' }}
            />
            <Box style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
              <Pressable onPress={() => setPrefabNameDraft(null)}>
                <Box style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderRadius: 5, backgroundColor: '#1e293b' }}>
                  <Text fontSize={11} color="#a8b6c8" style={{ fontFamily: 'monospace' }}>Cancel</Text>
                </Box>
              </Pressable>
              <Pressable onPress={() => { saveSelectionAsPrefab(prefabNameDraft); setPrefabNameDraft(null); }}>
                <Box style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderRadius: 5, backgroundColor: '#2563eb' }}>
                  <Text fontSize={11} color="#eaf4ff" style={{ fontFamily: 'monospace' }}>Save prefab</Text>
                </Box>
              </Pressable>
            </Box>
          </Box>
        </Box>
      ) : null}
    </Box>
  );
});

function IsoBtn(props: { label: string; onPress: () => void; title?: string }) {
  // The icons are cryptic, so each carries a hover tooltip — the engine-native one
  // (hoverable + tooltip, painted by framework/tooltip.zig as an overlay), the same
  // door cart/testing_carts/tooltip_test.tsx exercises. No layout shift here: the
  // cluster is an absolutely-positioned overlay, and the tooltip paints over the scene.
  return (
    <Pressable onPress={props.onPress} hoverable={props.title ? true : undefined} tooltip={props.title}>
      <Box style={{ width: 26, height: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: BUILD_UI.panelBg, borderRadius: 4 }}>
        <Text fontSize={12} color="#cbd5e1">{props.label}</Text>
      </Box>
    </Pressable>
  );
}

// The build grid: lines on the active floor, world-anchored. ADAPTIVE LOD — a fixed
// 26-tile patch vanished to a speck when zoomed out over the big map (and the thin
// lines went sub-pixel). Instead the cell SIZE, the coverage, and the line THICKNESS
// all scale with the eye distance, so the grid always fills the view and reads clearly:
// zoomed in you get 1-tile cells, zoomed out you get coarse 8/16/32-tile cells, never
// a blizzard of lines (the count stays bounded at ~2·HALF_LINES per axis). The cell
// step stays a "nice" 1 tile = 1 m multiple, so the grid always lands on real cells.
// (Scene3D's showGrid prop is a no-op — the grid IS these thin line boxes.)
const GRID_HALF_LINES = 56;            // lines each side of centre → ~226 boxes total, bounded
const GRID_NICE_STEPS = [1, 2, 4, 8, 16, 32, 64, 128, 256];
const GRID_MINOR = '#3c5575';
const GRID_MAJOR = '#7da0cf';
// The cell size (tiles) for the current eye distance. Cover only the VISIBLE ground
// (≈0.31× the eye distance each way at this fov) — NOT a big multiple of it — so the
// grid HOLDS the true 1-tile pitch through the entire building-zoom range: a wall on a
// tile line reads as on the line at every zoom you'd actually place at (down to ~zoom
// 0.5). It only coarsens to 2/4/8… cells when you pull WAY out to survey a district,
// where single cells aren't placeable anyway. (The prior tuning coarsened to 4-tile
// cells at DEFAULT zoom, so 1-tile-snapped pieces sat between the grid lines — the
// "aligned zoomed-in, off-grid zoomed-out" bug.) Steps stay nice 1·2·4·8 multiples of
// the 1 tile = 1 m grid, so the lines always fall on real cell boundaries.
function gridStepFor(distanceMeters: number): number {
  const raw = Math.max(6, distanceMeters * 0.31) / GRID_HALF_LINES;
  for (const s of GRID_NICE_STEPS) if (s >= raw) return s;
  return GRID_NICE_STEPS[GRID_NICE_STEPS.length - 1];
}
const IsoGrid = memo(function IsoGrid(props: { centerX: number; centerZ: number; level: number; distance: number }) {
  const step = gridStepFor(props.distance);
  // snap the centre to the cell step so lines stay world-anchored (a multiple of step)
  // and don't shimmer as you pan — a sub-step pan is just a position UPDATE, no rebuild.
  const cx = Math.round(props.centerX / step) * step;
  const cz = Math.round(props.centerZ / step) * step;
  const y = props.level * METERS_PER_LEVEL + 0.04; // above the floor so it never z-fights
  const span = GRID_HALF_LINES * step * 2;          // full extent each axis (world units)
  const majorEvery = step * 8;                       // a bold line every 8 cells of this LOD
  const minorT = 0.08 * step;                        // thickness scales with cell size so
  const majorT = 0.22 * step;                        // lines never go sub-pixel when zoomed out
  const lines: any[] = [];
  for (let k = -GRID_HALF_LINES; k <= GRID_HALF_LINES; k += 1) {
    const wx = cx + k * step;
    const majorX = Math.round(wx) % majorEvery === 0;
    lines.push(
      <Scene3D.Mesh key={`gx${k}`} geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }}
        scale={[majorX ? majorT : minorT, 0.05, span]} position={[wx, y, cz]}
        material={{ color: majorX ? GRID_MAJOR : GRID_MINOR, opacity: majorX ? 0.9 : 0.7 }} />,
    );
    const wz = cz + k * step;
    const majorZ = Math.round(wz) % majorEvery === 0;
    lines.push(
      <Scene3D.Mesh key={`gz${k}`} geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }}
        scale={[span, 0.05, majorZ ? majorT : minorT]} position={[cx, y, wz]}
        material={{ color: majorZ ? GRID_MAJOR : GRID_MINOR, opacity: majorZ ? 0.9 : 0.7 }} />,
    );
  }
  return <>{lines}</>;
}, (p, n) => {
  // rebuild only when the LOD step changes or the snapped centre moves a whole cell
  const sp = gridStepFor(p.distance), sn = gridStepFor(n.distance);
  return sp === sn
    && Math.round(p.centerX / sp) === Math.round(n.centerX / sn)
    && Math.round(p.centerZ / sp) === Math.round(n.centerZ / sn)
    && p.level === n.level;
});

// The bottom build palette. A row of kind tabs (floor/wall/ramp/...) and, under the
// active tab, that kind's catalog entries as chips — the Sims bottom bar, fed by the
// SAME BUILD_CATALOG the F2 palette reads.
type RailTab = BuildPieceKind | 'prefabs';
const RAIL_TABS: RailTab[] = [...PALETTE_KINDS, 'prefabs'];
const CatalogRail = memo(function CatalogRail(props: { armed: Armed; prefabs: readonly BuildPrefabDef[]; onArm: (a: NonNullable<Armed>) => void }) {
  const [tab, setTab] = useState<RailTab>('wall');
  // 'prefabs' lists the named compositions (stamp → many pieces) — the FULL list the cart
  // passes (built-in + user-captured stream prefabs); every other tab lists that kind's
  // catalog pieces. Both feed the SAME rail, fed by the SAME GAME_BUILD.
  const entries = useMemo<{ id: string; label: string }[]>(
    () => (tab === 'prefabs' ? props.prefabs.map((d) => ({ id: d.id, label: d.label })) : GAME_BUILD.catalog.byKind(tab)),
    [tab, props.prefabs],
  );
  const armKind: 'piece' | 'prefab' = tab === 'prefabs' ? 'prefab' : 'piece';
  const armedId = props.armed && props.armed.kind !== 'tower' ? props.armed.id : null;
  const towerArmed = props.armed?.kind === 'tower';
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
        {/* the TOWER tool (req_0478) — not a catalog kind, a whole-shell drag tool.
            Box metrics match the kind tabs exactly (no border, same padding) — the
            extra border + the emoji glyph's leading advance read as a weird left
            padding (req_0483); the gold background alone marks it special. */}
        <Pressable onPress={() => props.onArm({ kind: 'tower' })}>
          <Box style={{ paddingLeft: 9, paddingRight: 9, paddingTop: 4, paddingBottom: 4, borderRadius: 4, backgroundColor: towerArmed ? '#1d4ed8' : '#4a3a12' }}>
            <Text fontSize={11} color={towerArmed ? '#ffffff' : '#f0d9a8'} style={{ fontFamily: 'monospace' }}>tower</Text>
          </Box>
        </Pressable>
      </Box>
      <Box style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap' }}>
        {entries.map((def) => (
          <Pressable key={def.id} onPress={() => props.onArm({ kind: armKind, id: def.id })}>
            <Box style={{ paddingLeft: 9, paddingRight: 9, paddingTop: 6, paddingBottom: 6, borderRadius: 5, borderWidth: 1, borderColor: armedId === def.id ? '#7dd3fc' : '#3a4f6b', backgroundColor: armedId === def.id ? '#1d4ed8' : '#16233a' }}>
              <Text fontSize={11} color={armedId === def.id ? '#ffffff' : '#dbe6f3'} style={{ fontFamily: 'monospace' }}>{def.label}</Text>
            </Box>
          </Pressable>
        ))}
      </Box>
    </Box>
  );
});
