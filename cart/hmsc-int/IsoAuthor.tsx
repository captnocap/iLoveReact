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
import { useRerender } from '@reactjit/runtime/hooks';
import { Box, Pressable, Scene3D, ScrollView, Text, TextInput } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import { GAME_BUILD, GAME_NATIVE_CAMERA, buildingDefFromPieces, buildingPieceInstanceId, partitionBuildingSelection } from './game';
import type { BuildEditEvent, BuildFaceSlot, BuildPieceKind, BuildPrefabDef, BuildSkinSet, BuildingInstance, PlacedBuildPiece, Rect, WallEdit, WorldEvent, WorldGridState } from './game';
import { landformGroundTopAt } from './game/world'; // [propgone] burial probe (req_1635)
import { resolveSnapTarget, modulePitch, nearestWallLineAnchor, nearestPlateLatticeAnchor, anchoredRunCenter, SNAP_TUNING_DEFAULTS, type SnapTarget, type WallLineAnchor } from './editors/build/snap';
import { pieceVisualShapes, VisualShapeMesh, PlacedPieceMeshes, GhostPiece, elevatorCarVisualShape, texturedPropsFromPieces } from './editors/build/pieceMeshes';
import { perfMs, warnPlaceFreeze } from './editors/build/placeFreezeProbe';
import { logPiecePlaced, logPiecesPlaced, logPrefabStamped } from './editors/build/placeLog';
import { BUILD_UI } from './editors/build/buildUi';
import { IsoStage, METERS_PER_LEVEL, type IsoPose } from './isoStage';
import { readRouteTwigState, writeRouteTwigState, useRouteTwigState } from './editors/twigs';
import { useEditorControls, useHeldModifiers } from './editors/useEditorControls';
import type { GameState } from './design';
import { WorldStatics } from './render3d/GameWorld3D';
import { LandformSurfaceCaptures } from './render3d/Landform';
import { PropSurfaceCaptures } from './render3d/PropCaptures';
import { WorldPartCaptures } from './render3d/PartCaptures';
import { TextureCapture } from './game/textures/registry';
import { groundColumnTop } from './Embodied';
import { CHUNK_TILES } from './chunks';
import { parseAddress, cellAddress } from './address';
import { TILE_KINDS } from './world/tileKinds';
import { PROP_CATEGORIES, PROP_CATEGORY_NAMES, isPropKind, propCategory, type PropCategory } from './game/kinds/props';
import { useCookedAssets, cookedPropSurfaceYs } from './editors/model/cookedAssets';
import { WATER_BODY_PRESETS, WATER_BODY_PRESET_IDS } from './game/kinds/waterBodies';
import { PropBrowser } from './PropBrowser';

const FAR_CLIP = 4000;
// The iso eye sits BASE_DIST/zoom (~90–257m) from the ground, far past F2's 14m
// crosshair reach — so the ground march has to travel much further before it dips
// under the terrain. A coarser step keeps the per-move cost sane at that range.
const ISO_SNAP_TUNING = { ...SNAP_TUNING_DEFAULTS, reachMeters: 600, groundMarchStepMeters: 0.5 };
const FREEFORM_MOVE_SNAP_METERS = ISO_SNAP_TUNING.freeformSnapMeters;

// The build palette, ruled-hotkey order first (floor, wall, ramp, roof), then the
// rest — same kinds F2's palette leads with. Each tab lists its catalog entries.
const PALETTE_KINDS: BuildPieceKind[] = ['floor', 'wall', 'ramp', 'roof', 'stairs', 'elevator', 'pillar', 'prop'];

// Route id the iso camera pose persists under (editors/twigs) so a hot reload — which
// remounts this component and reconstructs the IsoStage — restores where you were
// looking instead of snapping back to the content centroid. One global pose across
// maps (the pane isn't passed a map stem); the ⌂/F recenter fixes it in one click if
// you open a different map and the saved pose points somewhere stale.
const ISO_ROUTE = '/iso-build';
const ISO_CAM_TWIG = 'camera';

const ARROW_TO_WASD: Record<string, string> = { arrowup: 'w', arrowdown: 's', arrowleft: 'a', arrowright: 'd' };

// One-shot guard flag (req_0717): a NON-FINITE ground sample (a malformed
// landform/heightfield → groundColumnTop returns NaN/Infinity) makes
// liftToTerrain hand the piece y=NaN, and the cut-away (p.y - groundTopAt < cut)
// is then false at EVERY floor level — so the piece silently vanishes from the
// iso pane while the compiled world (a different sampler) renders it fine. We
// clamp the sample to 0 so the piece still stands, and warn ONCE so the real
// culprit (the bad landform) surfaces instead of being masked.
let warnedNonFiniteGround = false;

// Where the view opens / recenters: the centroid of what's already built, so you
// start looking AT the map instead of an empty chunk corner. Empty map → chunk centre.
function contentCenter(pieces: readonly PlacedBuildPiece[]): [number, number] {
  if (!pieces.length) return [CHUNK_TILES / 2, CHUNK_TILES / 2];
  let sx = 0, sz = 0;
  for (const p of pieces) { sx += p.x; sz += p.z; }
  return [sx / pieces.length, sz / pieces.length];
}

function quantizeMeters(v: number, step: number): number {
  return step > 0 ? Math.round(v / step) * step : v;
}

function normalizeYawDegrees(yawDegrees: number): number {
  return ((yawDegrees % 360) + 360) % 360;
}

function isPropPiece(piece: PlacedBuildPiece): boolean {
  return GAME_BUILD.catalog.get(piece.pieceId).kind === 'prop';
}

function isWallPiece(piece: PlacedBuildPiece): boolean {
  return GAME_BUILD.catalog.get(piece.pieceId).kind === 'wall';
}

function selectionIsOnlyProps(ids: ReadonlySet<string>, pieces: readonly PlacedBuildPiece[]): boolean {
  let found = false;
  for (const piece of pieces) {
    if (!ids.has(piece.id)) continue;
    found = true;
    if (!isPropPiece(piece)) return false;
  }
  return found;
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
export type Armed = { kind: 'piece' | 'prefab'; id: string } | { kind: 'tower' } | { kind: 'water'; id: string } | null;

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

// The face painter (req_0478 → req_0483 → req_0702) lives in
// ./editors/build/FacePainter, mounted in the cart's top-right PAINT tab — this
// pane only reports its selection up (onSelectionChange) so the map stays clear.

/** the same tool armed twice = a toggle-off (rail chips re-click to disarm) */
export function sameArmed(cur: Armed, next: NonNullable<Armed>): boolean {
  if (!cur || cur.kind !== next.kind) return false;
  if (cur.kind === 'tower' || next.kind === 'tower') return true;
  return cur.id === next.id;
}

export interface IsoAuthorProps {
  // The world to draw UNDER the pieces (terrain + props), same GameState the inspect
  // pane renders — preview==game.
  state: GameState;
  // The standing pieces (the cart's materialized worldStream truth ⊕ derived
  // building stamps) + the commit the cart already funnels F2 placements
  // through. This pane is just another caller. Events may target the world OR
  // the buildings channel (req_0513) — the shell routes by kind.
  pieces: readonly PlacedBuildPiece[];
  onCommit: (event: BuildEditEvent, label: string) => void;
  // Batch commit: many events as ONE undoable action with ONE store snapshot. Bulk ops
  // (move/clone/delete a whole building) use this so they don't freeze the editor with
  // a snapshot per piece. Absent (older host) → the pane falls back to per-event onCommit.
  onCommitMany?: (items: ReadonlyArray<{ event: BuildEditEvent; label: string }>) => void;
  // This map's building INSTANCES (req_0513): id → {defId, position, yaw}. A
  // whole-instance selection moves/clones/deletes as ONE event on the
  // building's own history branch instead of a remove+place storm.
  buildings?: Readonly<Record<string, BuildingInstance>>;
  // The FULL prefab list — built-ins AND the user-captured (stream) prefabs the cart
  // already merges for F2. The rail shows these; absent = built-ins only.
  prefabs?: readonly BuildPrefabDef[];
  // World (x,z) -> ground height (m). Level-0 picks follow it; absent = flat ground.
  groundTopAt?: (x: number, z: number) => number;
  // WASD/key focus is owned by the cart (shared across panes); true = this pane
  // drives input. A click here claims it.
  focused?: boolean;
  onFocus?: () => void;
  // Selection mirror (req_0702): the cart hosts the face painter in the top-right
  // PAINT tab, so it needs to know what's selected here. Fired on every change.
  onSelectionChange?: (ids: ReadonlySet<string>) => void;
  // Drop a body of water (world/water) at a clicked ground point. The WATER rail
  // tab arms a preset; a ground click fires this with the preset kind + world
  // (x,z). The cart turns it into a water placement (cat 'water') — reusing the
  // placement system, so it persists/positions/bakes like any placement.
  onPlaceWaterBody?: (presetKind: string, x: number, z: number) => void;
  // RAILHOIST req_1888: the catalog rail moved to the editor rail, so `armed` is owned
  // by the editor (index.tsx) and passed in. Absent → local state (standalone use).
  armed?: Armed;
  onArm?: (next: Armed | ((cur: Armed) => Armed)) => void;
}

// A placement's identity-free fingerprint (kind + pose). The rotate flow uses
// it to re-find a loose piece after remove+place hands it a fresh stream id.
function pieceSignature(p: { pieceId: string; x: number; y: number; z: number; yawDegrees: number }): string {
  return `${p.pieceId}|${p.x.toFixed(2)}|${p.y.toFixed(2)}|${p.z.toFixed(2)}|${Math.round(p.yawDegrees)}`;
}

export const IsoAuthor = memo(function IsoAuthor(props: IsoAuthorProps) {
  const { state, pieces, onCommit } = props;
  // Commit many events as ONE undoable action (one store snapshot) when the host offers
  // it; else fall back to per-event onCommit. Move/clone/delete-building route through
  // this so a big building doesn't freeze on a snapshot-per-piece.
  const commitBatch = useCallback((items: ReadonlyArray<{ event: BuildEditEvent; label: string }>) => {
    if (!items.length) return;
    if (props.onCommitMany) props.onCommitMany(items);
    else for (const it of items) onCommit(it.event, it.label);
  }, [props.onCommitMany, onCommit]);
  // Live building instances, read at event time through a ref (the Pressable
  // stale-closure discipline every handler here follows).
  const buildingsRef = useRef(props.buildings);
  buildingsRef.current = props.buildings;
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

  // [propgone] BURIAL PROBE (req_1635) — props render at piece.y but the painted
  // floor may be raised above it; if so the mesh sits UNDER the terrain (clickable
  // physics rect, no visible mesh). Logs the ground top vs y for each prop-kind
  // piece, once per (kind,buried?) outcome.
  useMemo(() => {
    const seen = new Set<string>();
    let buried = 0, ok = 0;
    for (const p of pieces) {
      if (GAME_BUILD.catalog.get(p.pieceId).kind !== 'prop') continue;
      const top = landformGroundTopAt(worldGrid, p.x, p.z);
      const isBuried = top !== undefined && top > (p.y ?? 0) + 0.05;
      if (isBuried) buried += 1; else ok += 1;
      const key = `${p.pieceId}:${isBuried ? 'BURIED' : 'ok'}`;
      if (!seen.has(key)) {
        seen.add(key);
        console.warn(`[propgone] burial ${p.pieceId} y=${(p.y ?? 0).toFixed(2)} groundTop=${top === undefined ? 'none' : top.toFixed(2)} → ${isBuried ? 'BURIED under terrain' : 'visible'}`);
      }
    }
    console.warn(`[propgone] burial summary: ${buried} buried, ${ok} on-or-above ground (of prop pieces)`);
    return null;
  }, [pieces, worldGrid]);

  // Tile lookup (req_0823): type an address (e.g. "EI120") → highlight that exact
  // tile in the 3D and report the kind the renderer resolves there. This is the
  // ground-truth cross-reference between the editor address grid and what the iso
  // pane actually draws — if the highlight box lands off the named tile, the
  // address↔world mapping is the bug; if it lands ON it but the cell reads a
  // different kind than the 2D, the tile data diverged.
  const [lookupAddr, setLookupAddr] = useState('');
  const [lookupCell, setLookupCell] = useState<{ gx: number; gz: number } | null>(null);
  const lookup = useMemo(() => {
    if (!lookupCell) return null;
    const { gx, gz } = lookupCell;
    const cx = Math.floor(gx / CHUNK_TILES), cz = Math.floor(gz / CHUNK_TILES);
    const lf = (state.world.landforms ?? []).find((l: any) => l.id === `painted_${cx}_${cz}`) as any;
    const tiles = lf?.field?.tiles;
    let kind = 'no chunk';
    let shaderKind = '-';
    if (tiles && lf) {
      const lx = gx - cx * CHUNK_TILES, lz = gz - cz * CHUNK_TILES;
      const v = tiles.idx[lz * tiles.cols + lx];
      kind = (v >= 0 && v < TILE_KINDS.length) ? TILE_KINDS[v] : 'empty';
      // SHADER-PATH read (req_0828): reproduce exactly how the ground formula maps a
      // world point → cell — world → mesh uv → floor(uv*tiles.cols). Uses the REAL
      // mesh footprint (heightfield resolution+cell), not the tile grid. If this
      // disagrees with the direct (lx,lz) read above, the heightfield-mesh↔tile-grid
      // mapping is the bug.
      const cs = state.world.cellSizeMeters || 1;
      const hf = lf.field;
      const meshW = (Math.max(hf.cols, hf.rows) - 1) * hf.cell; // bakeTerrainField width
      const leftX = lf.centerX - meshW / 2, topZ = lf.centerZ - meshW / 2;
      const wx = (gx + 0.5) * cs, wz = (gz + 0.5) * cs;
      const uvx = (wx - leftX) / meshW, uvy = (wz - topZ) / meshW;
      const scx = Math.floor(uvx * tiles.cols), scy = Math.floor(uvy * tiles.rows);
      if (scx >= 0 && scx < tiles.cols && scy >= 0 && scy < tiles.rows) {
        const sv = tiles.idx[scy * tiles.cols + scx];
        shaderKind = `${(sv >= 0 && sv < TILE_KINDS.length) ? TILE_KINDS[sv] : 'empty'}@(${scx},${scy})`;
      } else shaderKind = `oob(${scx},${scy})`;
    }
    return { gx, gz, cx, cz, kind, shaderKind };
  }, [lookupCell, state.world.landforms, state.world.cellSizeMeters]);

  const groundTopAt = useMemo<(x: number, z: number) => number>(() => {
    const base = props.groundTopAt ?? ((x, z) => groundColumnTop(worldGrid, x, z));
    // Guard non-finite samples so the lift/cut never silently drop a piece (see
    // warnedNonFiniteGround above). The warn names the offending coords so the
    // malformed landform is findable.
    return (x, z) => {
      const t = base(x, z);
      if (Number.isFinite(t)) return t;
      if (!warnedNonFiniteGround) {
        warnedNonFiniteGround = true;
        console.warn(`[iso-author] non-finite ground sample at (${x.toFixed(1)},${z.toFixed(1)}) — a malformed landform/heightfield; placed pieces would vanish (lift→NaN→cut-away). Clamping to 0.`);
      }
      return 0;
    };
  }, [props.groundTopAt, worldGrid]);
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
  const rerender = useRerender();
  // [iso-diag req_1744] TEMP probe for the blank iso pane: names the cause the next
  // time / loads — empty scene, a non-finite boot camera, or the native camera not
  // engaging. Re-runs on world/piece change. Remove once the blank is fixed.
  useEffect(() => {
    const finite = (v: any): boolean => Array.isArray(v) && v.every((n) => Number.isFinite(n));
    let texturedN = -1;
    try { texturedN = texturedPropsFromPieces(pieces).length; } catch (e) { console.warn('[iso-diag] texturedPropsFromPieces THREW', String(e)); }
    console.warn(
      `[iso-diag] pieces=${pieces.length} display=${displayPieces.length} ` +
      `props=${state.world.props.length} landforms=${(state.world.landforms ?? []).length} textured=${texturedN} ` +
      `camPos=${finite(bootCam.pos) ? 'ok' : JSON.stringify(bootCam.pos)} ` +
      `camTarget=${finite(bootCam.target) ? 'ok' : JSON.stringify(bootCam.target)} ` +
      `fov=${Number.isFinite(bootCam.fov) ? bootCam.fov : 'NaN'} nativeCamId=${Number(cameraRef.current?.id ?? 0)}`,
    );
  }, [state.world, pieces]);
  const redraw = useCallback(() => {
    pushNativeCamera();
    rerender();
  }, [pushNativeCamera, rerender]);
  // Persist the camera pose at REST points (drag/key release, wheel, button) — never
  // per frame — so a hot reload resumes the view. sculptCamera keeps the same discipline.
  const saveCamera = useCallback(() => { writeRouteTwigState(ISO_ROUTE, ISO_CAM_TWIG, { ...stage.pose }); }, [stage]);
  const recenter = useCallback(() => { const [cx, cz] = contentCenter(piecesRef.current); stage.centerOn(cx, cz); redraw(); saveCamera(); }, [stage, redraw, saveCamera]);

  // armed is editor-owned when passed (req_1888), else local (standalone fallback).
  const [localArmed, setLocalArmed] = useState<Armed>(null);
  const armed = props.armed ?? localArmed;
  const setArmed = props.onArm ?? setLocalArmed;
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
  // Arming a piece (from the editor-rail catalog now, req_1888) clears any selection.
  useEffect(() => { if (armed && selectedIdsRef.current.size) setSelectedIds(new Set()); }, [armed]);
  // Mirror the selection up to the cart (req_0702) — the top-right PAINT tab
  // paints whatever is selected here. Ref'd callback: a parent re-render must
  // not re-fire the effect with an unchanged selection.
  const onSelectionChangeRef = useRef(props.onSelectionChange);
  onSelectionChangeRef.current = props.onSelectionChange;
  useEffect(() => { onSelectionChangeRef.current?.(selectedIds); }, [selectedIds]);
  // Re-acquire rotated loose pieces (req_0645): a loose-piece rotation is
  // remove+place (no pieceMoved event exists), so its id dies with the commit.
  // rotateSelected parks the new placements' signatures here; when the
  // re-materialized pieces arrive, matching ones re-enter the selection — so
  // R,R,R keeps turning the same thing without re-clicking.
  const reselectRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const want = reselectRef.current;
    if (!want?.size) return;
    const found = pieces.filter((p) => want.has(pieceSignature(p)));
    if (!found.length) return;
    reselectRef.current = null;
    setSelectedIds((prev) => new Set([...prev, ...found.map((p) => p.id)]));
  }, [pieces]);
  // Default to SINGLE-piece select so you can always grab one piece even when it touches
  // others (the toggle below flips the default; Shift/Alt inverts it for one click). A
  // whole-building select buried single-piece editing — req_0459.
  const [wholeBuilding, setWholeBuilding] = useState(false);
  const wholeBuildingRef = useRef(wholeBuilding);
  wholeBuildingRef.current = wholeBuilding;
  const [wallsVisible, setWallsVisible] = useRouteTwigState<boolean>(ISO_ROUTE, 'wallsVisible', true);
  // Default OFF (req_1638): the flora PREVIEW builds the full grass/palm field in JS
  // (up to MAX_INSTANCES=1,048,576 blades × STRIDE-12 floats + 200k+ palm fronds) on
  // every cold start, which OOMs the editor heap on a grass-heavy map BEFORE it ever
  // renders — so the user sees no grass yet the build still kills the editor. Cold
  // start hidden; toggle "Fl" to populate it when the map is light enough. The durable
  // fix (a lightweight shader preview that doesn't materialise a million JS rows) lives
  // in the flora refactor.
  const [floraVisible, setFloraVisible] = useRouteTwigState<boolean>(ISO_ROUTE, 'floraVisible', false);
  // Show the WHOLE building stack (req_0721/req_0722). The floor-level cut-away
  // (storey ≥ the active level vanishes) is the "look into one floor" tool — show
  // the active floor and everything BELOW, hide what's above so you can see and
  // edit inside the storey you're on (the Sims "view this level" move).
  // DEFAULT OFF = cut-away ON (req_0737). It was forced ON (showAllFloors=true) as
  // a band-aid for the iso-pane buildings-vanishing bug (commit 79da84357), back
  // when that was misdiagnosed as the cut-away stripping the city. The real cause
  // was the geometry-dedup desync (fixed in runtime/primitives.tsx, req_0735), so
  // the band-aid is obsolete and only got in the way — an upper floor occluded the
  // floor being edited. The ⌷ toggle still shows the whole city when wanted.
  // Twig key is bumped to v2: the old 'showAllFloors' is persisted to disk, so a
  // user who ran the band-aid build has true saved — orphan it so this OFF default
  // actually applies instead of resurrecting the all-floors view (req_0737).
  const [showAllFloors, setShowAllFloors] = useRouteTwigState<boolean>(ISO_ROUTE, 'showAllFloors_v2', false);
  // Shift/Alt held? Mouse events carry no modifier flags here — read the shared
  // contract tracker at click time to invert the select scope / go freeform.
  const heldModifiers = useHeldModifiers();
  // An in-progress move drag: the world (dx,dz) the selection is being dragged by on
  // the active level's plane, or null when not moving. Drives the move ghost; the
  // selection re-places (remove+place) on mouse-up.
  const [moveDelta, setMoveDelta] = useState<{ dx: number; dz: number; dy: number } | null>(null);
  const moveDeltaRef = useRef(moveDelta);
  moveDeltaRef.current = moveDelta;
  // An in-progress drag-paint: the placements a wall LINE or floor RECT would drop,
  // previewed as ghosts and batch-placed on mouse-up. null when not painting.
  type Paint = { pieceId: string; x: number; y: number; z: number; yawDegrees: number; roofSpan?: { widthMeters: number; depthMeters: number } };
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
  // When the user last touched this pane (req_0516): the stall watchdog uses
  // it to tell INTERACTION stalls (drag/commit windows — the lag the user
  // feels) from IDLE stalls (external machine load: agent builds, the dev
  // watcher re-bundling, a verify suite — real starvation, but NOT drag lag).
  // Same clock as the watchdog tick (performance.now), NOT perfMs (which may
  // ride __bench_now_us on a different epoch).
  const lastInputAtRef = useRef(0);
  const markInput = () => { lastInputAtRef.current = (globalThis as any).performance?.now?.() ?? 0; };
  // When the orphaned-gesture watchdog (req_0517, in the focus loop below)
  // first saw the button UP while dragRef was still set. 0 = not suspicious.
  const orphanSinceRef = useRef(0);
  // ── Optimistic edits (req_0511: "the user interface had 0 delay, and
  // everything just resolves its whole scene graph behind the scenes") ─────
  // Release costs nothing: the drag ghost (already mounted, stable keys)
  // turns SOLID in place, the originals hide, and the store batch + scene
  // re-derivation run a tick later behind a "confirming…" pill. When the
  // standing pieces reflect the change, the overlay drops — the ghost nodes
  // were the building all along, so confirm is a prop swap, not a remount.
  // pendingMove: the ids being moved (hidden from the standing render) — the
  // move ghost holds the building at its new spot meanwhile. pendingPaint:
  // the painted cells stay rendered (solid) until the real pieces land.
  // A pieces change from ANY source clears the overlays (undo, co-session);
  // the deferred batch still applies, so the world stays consistent.
  const [pendingMove, setPendingMove] = useState<ReadonlySet<string> | null>(null);
  // The selection's lifted pieces at move-commit time: the solid confirm ghost
  // renders from this snapshot. A moved BUILDING keeps its derived ids
  // (req_0513), so the live displayPieces already hold the NEW pose during the
  // catch-up frame — rendering the ghost from them would double-shift it.
  const pendingMoveSnapRef = useRef<readonly PlacedBuildPiece[]>([]);
  const [pendingPaint, setPendingPaint] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ReadonlySet<string> | null>(null);
  const pendingAny = pendingMove !== null || pendingPaint || pendingDelete !== null;
  useEffect(() => {
    const c = commitPerfRef.current;
    if (c) {
      commitPerfRef.current = null;
      console.warn(`[DRAGDRAW] ${c.label} -> standing ms=${(perfMs() - c.t0).toFixed(1)} pieces=${pieces.length}`);
    }
    // The standing world caught up — drop the optimistic overlays.
    setPendingMove((p) => (p ? null : p));
    setPendingPaint((p) => (p ? false : p));
    setPendingDelete((p) => (p ? null : p));
    setMoveDelta((d) => (d && !dragRef.current ? null : d));
    if (!dragRef.current) { setPaintCells((c2) => (c2 ? null : c2)); paintSigRef.current = ''; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const [prefabUpdateOpen, setPrefabUpdateOpen] = useState(false);
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

  // req_1687: the WORLD-Y of every flat surface a placed prop can hold a prop on
  // (a multi-layer model's boards), so the snap resolver lands a prop on the LAYER
  // under the crosshair instead of the box top. The prop-local levels come from the
  // cooked mesh (cached by meshRef); piece.y lifts them to world. Non-multi-layer
  // props return null and keep box-top placement.
  const propSurfacesFor = useCallback((piece: PlacedBuildPiece): number[] | null => {
    const def = GAME_BUILD.catalog.get(piece.pieceId);
    if (def.kind !== 'prop' || !def.propKind) return null;
    const local = cookedPropSurfaceYs(def.propKind);
    return local ? local.map((y) => piece.y + y) : null;
  }, []);

  // Resolve the cursor to a snap target with the SAME inputs F2 uses (the armed
  // catalog entry's snap mode + size, the ghost yaw, the standing pieces).
  const resolveAt = useCallback((sx: number, sy: number): SnapTarget | null => {
    const a = armedRef.current;
    if (!a) return null;
    // A piece snaps by its own catalog rule (walls edge-snap, etc.); a prefab drops on
    // the grid by its floor-plate anchor (req_0668: the capture origin is often a wall
    // line, so origin snapping put a stamped room's floors off the world floor
    // lattice) — exactly how F2's refreshSnapTarget picks snap/size/anchor. The tower
    // tool grid-snaps a wall-module footprint (a click drops a 1×1-cell tower).
    const pieceDef = a.kind === 'piece' ? GAME_BUILD.catalog.get(a.id) : null;
    const armedPrefabDef = a.kind === 'prefab' ? prefabByIdRef.current.get(a.id) : undefined;
    const prefabAnchor = armedPrefabDef ? GAME_BUILD.prefabs.gridAnchor(armedPrefabDef) : null;
    const snap = pieceDef ? pieceDef.snap : 'grid';
    const size = pieceDef
      ? pieceDef.size
      : a.kind === 'tower'
        ? GAME_BUILD.catalog.get(TOWER_WALL_ID).size
        : prefabAnchor
          ? prefabAnchor.size
          : { widthMeters: 1, heightMeters: 3, depthMeters: 1 };
    // Alt = fine placement for EVERYTHING armed (REQ-0650, extending the
    // REQ-0596 prop override): 'free' props still land on the raw hit;
    // grid/edge modules step 1 tile (edges tile-aligned) instead of their
    // module pitch, so a building can stand 1–2 tiles from a road line.
    const freeform = !!heldModifiers.current.alt;
    return resolveSnapTarget({
      ray: stage.pieceRay(sx, sy, rectRef.current),
      // The VISIBLE (cut-away) list, not the full world: placement obeys the
      // same law as grab — you can't snap onto what you can't see. Against
      // the full list, a level-0 placement inside a roofed room raycast the
      // HIDDEN roof and stacked furniture on top of it (BEDROOF-0610: "the
      // bed keeps placing on the roof").
      pieces: visiblePiecesRef.current,
      groundTopAt: placeGroundAt, // active-floor aware → upper-floor placement lands up there
      snap,
      size,
      yawDegrees: ghostYawRef.current,
      freeform,
      propSurfacesFor, // req_1687: land a prop on the shelf layer under the cursor
      ...(prefabAnchor ? { anchorLocal: { x: prefabAnchor.x, z: prefabAnchor.z } } : {}),
      tuning: ISO_SNAP_TUNING,
    });
  }, [stage, placeGroundAt, propSurfacesFor]);
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
  const paintKindOf = (a: Armed): 'wall' | 'floor' | 'tower' | 'roof' | null => {
    if (!a) return null;
    if (a.kind === 'tower') return 'tower';
    if (a.kind !== 'piece') return null;
    const k = GAME_BUILD.catalog.get(a.id).kind;
    return k === 'wall' || k === 'floor' || k === 'roof' ? k : null;
  };
  // The top of the standing pieces under a dragged roof footprint — so a roof
  // dropped over a one-storey house RESTS ON its walls, not on the ground
  // (req_0917: "make a roof the size of the entire base floor"). null = nothing
  // under the rect, so the caller falls back to the terrain.
  const roofRestHeight = (minX: number, maxX: number, minZ: number, maxZ: number): number | null => {
    let top: number | null = null;
    for (const piece of visiblePiecesRef.current) {
      const b = GAME_BUILD.placed.bounds(piece);
      if (b.maxX <= minX || b.minX >= maxX || b.maxZ <= minZ || b.minZ >= maxZ) continue;
      if (top === null || b.topY > top) top = b.topY;
    }
    return top;
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
    if (kind === 'roof') {
      // req_0917: a roof drag is ONE roof piece sized to the dragged footprint
      // (roofSpan), not a tiling of plates — so a gable rides ONE ridge across
      // the whole base floor. It rests on the walls under the rect (or the
      // terrain if open), and the profile (pieceShapes) scales to the span.
      const [x0, x1] = range(cellOf(start.x), cellOf(end.x));
      const [z0, z1] = range(cellOf(start.z), cellOf(end.z));
      const minX = x0 * pitch, maxX = (x1 + 1) * pitch;
      const minZ = z0 * pitch, maxZ = (z1 + 1) * pitch;
      const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
      const y = roofRestHeight(minX, maxX, minZ, maxZ) ?? placeGroundAt(cx, cz);
      return [{
        pieceId: def.id, x: cx, y, z: cz, yawDegrees: ghostYawRef.current,
        roofSpan: { widthMeters: maxX - minX, depthMeters: maxZ - minZ },
      }];
    }
    const cells: { x: number; z: number; yaw: number }[] = [];
    if (kind === 'floor') {
      // req_0672: the SAME plate-lattice law as single-click grid snap — a
      // floor drag starting near standing plates fills THEIR grid (an off-
      // world-lattice building extends flush), world lattice in open space.
      const anchor = nearestPlateLatticeAnchor(visiblePiecesRef.current, start.x, start.z, ISO_SNAP_TUNING.plateAnchorMagnetMeters);
      const originX = anchor ? anchor.x - pitch / 2 : 0;
      const originZ = anchor ? anchor.z - pitch / 2 : 0;
      const cellFrom = (v: number, origin: number) => Math.floor((v - origin) / pitch);
      const centerFrom = (c: number, origin: number) => origin + (c + 0.5) * pitch;
      const [x0, x1] = range(cellFrom(start.x, originX), cellFrom(end.x, originX));
      const [z0, z1] = range(cellFrom(start.z, originZ), cellFrom(end.z, originZ));
      for (let cx = x0; cx <= x1; cx += 1) for (let cz = z0; cz <= z1; cz += 1) cells.push({ x: centerFrom(cx, originX), z: centerFrom(cz, originZ), yaw: 0 });
    } else {
      // wall: the longer drag axis is the run; the short axis pins to the nearest
      // 3m edge — anchored to real geometry first (REQ-0653: a stroke along an
      // off-lattice pad/run hugs ITS line, same law as single-click edge snap),
      // world lattice only in open space.
      const dx = Math.abs(end.x - start.x), dz = Math.abs(end.z - start.z);
      const magnet = ISO_SNAP_TUNING.wallAnchorMagnetMeters;
      const runCells = (anchor: WallLineAnchor | null, a0: number, a1: number): number[] => {
        if (!anchor) {
          const [c0, c1] = range(cellOf(a0), cellOf(a1));
          const out: number[] = [];
          for (let c = c0; c <= c1; c += 1) out.push(center(c));
          return out;
        }
        const lo = anchoredRunCenter(anchor, Math.min(a0, a1), pitch);
        const hi = anchoredRunCenter(anchor, Math.max(a0, a1), pitch);
        const out: number[] = [];
        for (let v = lo; v <= hi + 1e-6 && out.length < PAINT_MAX_SPAN; v += pitch) out.push(v);
        return out;
      };
      if (dx >= dz) {
        const anchor = nearestWallLineAnchor(visiblePiecesRef.current, 'z', start.z, start.x, pitch, magnet);
        const lineZ = anchor ? anchor.line : Math.round(start.z / pitch) * pitch;
        for (const x of runCells(anchor, start.x, end.x)) cells.push({ x, z: lineZ, yaw: 0 });
      } else {
        const anchor = nearestWallLineAnchor(visiblePiecesRef.current, 'x', start.x, start.z, pitch, magnet);
        const lineX = anchor ? anchor.line : Math.round(start.x / pitch) * pitch;
        for (const z of runCells(anchor, start.z, end.z)) cells.push({ x: lineX, z, yaw: 90 });
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
  // Commit a tower (req_0478 → req_0513): the full hollow shell — perimeter
  // walls stacked towerFloors high + a flat roof cap. A tower BIRTHS A
  // BUILDING: instead of N piecePlaced events it commits ONE def + ONE
  // instance on the buildings channel — the building owns its history from
  // its first moment, and a later move is one buildingMoved event.
  const commitTower = (start: { x: number; z: number }, end: { x: number; z: number }) => {
    const floors = Math.max(TOWER_MIN_FLOORS, Math.min(TOWER_MAX_FLOORS, towerFloorsRef.current));
    const ring = towerRing(start, end);
    const baseY = placeGroundAt(((ring.x0 + ring.x1 + 1) / 2) * ring.pitch, ((ring.z0 + ring.z1 + 1) / 2) * ring.pitch);
    const wallH = GAME_BUILD.catalog.get(TOWER_WALL_ID).size.heightMeters;
    const placements: Paint[] = [];
    for (let f = 0; f < floors; f += 1) {
      for (const c of ring.cells) placements.push({ pieceId: TOWER_WALL_ID, x: c.x, y: baseY + f * wallH, z: c.z, yawDegrees: c.yaw });
    }
    for (let cx = ring.x0; cx <= ring.x1; cx += 1) {
      for (let cz = ring.z0; cz <= ring.z1; cz += 1) {
        placements.push({ pieceId: TOWER_ROOF_ID, x: ring.center(cx), y: baseY + floors * wallH, z: ring.center(cz), yawDegrees: 0 });
      }
    }
    const valid = placements.filter((p) => GAME_BUILD.placed.validatePlacement(p).length === 0);
    if (!valid.length) return;
    const w = ring.x1 - ring.x0 + 1;
    const d = ring.z1 - ring.z0 + 1;
    const label = `Tower ${w}×${d}×${floors}F`;
    const capture = buildingDefFromPieces(label, valid);
    if (!capture) return;
    logPiecesPlaced(`iso tower (origin=${capture.origin.x.toFixed(2)},${capture.origin.z.toFixed(2)})`, valid);
    commitBatch([
      { event: { kind: 'buildingDefined', def: capture.def } as BuildEditEvent, label: `defined ${label}` },
      { event: { kind: 'buildingPlaced', defId: capture.def.id, x: capture.origin.x, y: capture.origin.y, z: capture.origin.z, yawDegrees: 0 } as BuildEditEvent, label: `tower ${w}×${d}×${floors}F` },
    ]);
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
    markInput();
    const p = local(e);
    let mode: 'rotate' | 'move' | 'paint' = 'rotate';
    let gx0 = 0, gz0 = 0;
    if (armedRef.current && paintKindOf(armedRef.current)) {
      // armed with a wall/floor → a drag PAINTS a line/rect; record the start ground point
      const g = stage.groundPoint(p.x, p.y, rectRef.current);
      if (g) {
        mode = 'paint';
        gx0 = g.x;
        gz0 = g.z;
        // A new paint gesture retires any optimistic overlay still confirming —
        // else the fresh ghost would inherit the solid pendingPaint look.
        setPendingPaint(false);
        setPaintCells(null);
      }
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
    orphanSinceRef.current = 0;
    // ANY fresh gesture retires a stale (non-confirming) paint preview
    // (req_0517): a preview whose drag got orphaned must never outlive the
    // next press — it suppresses the hover ghost while it stands.
    if (mode !== 'paint' && paintCellsRef.current && !pendingPaint) setPaintCells(null);
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
    markInput();
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
        // Ctrl + drag a prop = VERTICAL (height) move, the Z-free placement analogue of
        // Alt's freeform XY (req_0900: posters/signs need to ride up a wall, not sit on
        // the ground). Gated to prop-only selections like freeform — props keep an
        // authored height through the lift (restPropsOnSupport never pulls an elevated
        // prop down), structural pieces stay grid-aligned. Screen up/down → world height
        // via the camera-facing vertical plane through the drag-start ground point.
        const onlyProps = selectionIsOnlyProps(selectedIdsRef.current, piecesRef.current);
        const vertical = heldModifiers.current.ctrl && onlyProps;
        if (vertical) {
          const rawDy = stage.heightDelta({ x: d.gx0, z: d.gz0 }, d.x0, d.y0, p.x, p.y, rectRef.current);
          if (rawDy != null) {
            const dy = quantizeMeters(rawDy, FREEFORM_MOVE_SNAP_METERS);
            const cur = moveDeltaRef.current;
            if (!cur || cur.dy !== dy || cur.dx !== 0 || cur.dz !== 0) setMoveDelta({ dx: 0, dz: 0, dy });
          }
          return;
        }
        const g = stage.groundPoint(p.x, p.y, rectRef.current);
        // Snap structural moves to whole grid cells so buildings stay aligned.
        // Prop-only moves may hold Alt for intentional freeform nudges against walls.
        if (g) {
          const cs = state.world.cellSizeMeters || 1;
          const freeform = heldModifiers.current.alt && onlyProps;
          const rawDx = g.x - d.gx0;
          const rawDz = g.z - d.gz0;
          const dx = freeform ? quantizeMeters(rawDx, FREEFORM_MOVE_SNAP_METERS) : Math.round(rawDx / cs) * cs;
          const dz = freeform ? quantizeMeters(rawDz, FREEFORM_MOVE_SNAP_METERS) : Math.round(rawDz / cs) * cs;
          // Only update when the SNAPPED delta actually changes (req_0503):
          // a fresh {dx,dz} per raw mouse event re-rendered the whole pane +
          // rebuilt the 179-piece move ghost even while the drag sat inside
          // one cell — the same no-op-update class the paint drag had.
          const cur = moveDeltaRef.current;
          if (!cur || cur.dx !== dx || cur.dz !== dz || cur.dy !== 0) setMoveDelta({ dx, dz, dy: 0 });
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
    markInput();
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
      // Shift-click while ARMED selects the piece under the cursor instead of
      // placing (req_0645): the armed brush used to make placed things
      // untouchable — every click placed another — so click→R-rotate was only
      // reachable through Esc. Shift is free here (Alt = freeform place).
      if (heldModifiers.current.shift) {
        selectPieceAt(d.x0, d.y0, false);
        return;
      }
      const t = resolveAt(d.x0, d.y0);
      if (t) { setSnap(t); placeAt(t); }
    } else {
      selectAt(d.x0, d.y0);
    }
  };

  const placeAt = (t: SnapTarget) => {
    const a = armedRef.current;
    if (!a) return;
    // A stale selection must not eat the next R (selection-first rotate) —
    // placing means you've moved on from whatever was selected.
    if (selectedIdsRef.current.size) setSelectedIds(new Set());
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
      logPrefabStamped('iso', def, { x: t.placement.x, y: t.placement.y, z: t.placement.z }, t.placement.yawDegrees);
      onCommit({ kind: 'prefabStamped', prefabId: a.id, origin: { x: t.placement.x, y: t.placement.y, z: t.placement.z }, yawDegrees: t.placement.yawDegrees }, `stamped ${def.label} @ ${at}`);
      return;
    }
    if (a.kind === 'water') {
      // A body of water drops at the clicked ground point — the cart turns it into
      // a water placement (world/water). Not a piece commit; its own channel.
      props.onPlaceWaterBody?.(a.id, t.placement.x, t.placement.z);
      return;
    }
    const def = GAME_BUILD.catalog.get(a.id);
    // placementFor carries the row's defaultEdit (REQ-0647: Doorway/Window
    // walls land with their cut) — the SAME helper F2's place() uses.
    const placement = GAME_BUILD.placed.placementFor(def, t.placement);
    // TEMP diagnostic (req_1142): why a cooked prop "won't place". Logs the gate.
    if (a.id.startsWith('prop.studio.')) {
      const probs = GAME_BUILD.placed.validatePlacement(placement);
      console.warn(`[cooked-place] id=${a.id} isCatalogId=${GAME_BUILD.catalog.is(a.id)} y=${placement.y} problems=[${probs.join('; ')}]`);
    }
    if (GAME_BUILD.placed.validatePlacement(placement).length > 0) return;
    logPiecePlaced('iso place', placement);
    // Keep the thing you just placed live for same-key editing. The stream
    // mints the id, so reselect by pose signature when pieces materialize;
    // with a selection present, R rotates the landed piece before the armed
    // ghost. This is especially important for props, where pre-place yaw was
    // easy but post-place rotation required an extra select dance.
    reselectRef.current = new Set([pieceSignature(placement)]);
    onCommit({ kind: 'piecePlaced', placement }, `placed ${def.label} @ ${at}`);
  };

  // Select the piece under the cursor (raycast the standing pieces) — the whole
  // connected building, or a single piece. Empty click clears. `invert` flips
  // the whole-building toggle for this click (the disarmed shift/alt chord);
  // the armed shift-click path passes false (shift already meant "select").
  const selectPieceAt = (sx: number, sy: number, invert: boolean) => {
    // Hit-test the VISIBLE (terrain-lifted, cut-away-filtered) pieces so a click
    // lands on what's on screen — a hidden upper floor can't shadow the click.
    const hit = GAME_BUILD.placed.raycast(stage.pieceRay(sx, sy, rectRef.current), visiblePiecesRef.current, ISO_SNAP_TUNING.reachMeters);
    if (!hit) { setSelectedIds(new Set()); return; }
    // The toggle sets the default scope; Shift/Alt inverts it for this click. So a single
    // piece is always one click away (even touching others), and the whole building is one
    // modifier away — no need to flip the toggle to edit one piece. The connected
    // walk spans the FULL piece set (hidden floors included) so grabbing a
    // building grabs ALL of it — a move never tears off the cut-away storeys.
    const whole = wholeBuildingRef.current !== invert;
    setSelectedIds(whole ? GAME_BUILD.placed.connected(hit.piece.id, displayPiecesRef.current) : new Set([hit.piece.id]));
  };
  const selectAt = (sx: number, sy: number) => {
    selectPieceAt(sx, sy, heldModifiers.current.shift || heldModifiers.current.alt);
  };
  // Remove every selected piece (one pieceRemoved each, the SAME event F2's X
  // commits). A whole-building selection (req_0513) deletes as ONE
  // buildingRemoved on the building's own branch; a PARTIAL building
  // selection is skipped loudly — piece-scoped building edits are slice 2,
  // and a half-deleted instance must never be faked with no-op events.
  // Optimistic (req_0511): the pieces vanish from the render THIS frame; the
  // store batch lands a tick later behind the confirming pill.
  const deleteSelected = () => {
    const idSet = selectedIdsRef.current;
    if (!idSet.size) return;
    const { wholeInstances, partialInstances, loosePieceIds } = partitionBuildingSelection(idSet, piecesRef.current);
    if (partialInstances.length) console.warn(`[iso-author] delete skipped ${partialInstances.length} partially-selected building(s) — select the whole building (▦ or shift-click)`);
    const events: Array<{ event: BuildEditEvent; label: string }> = [
      ...wholeInstances.map((instId) => ({ event: { kind: 'buildingRemoved', id: instId } as BuildEditEvent, label: `removed building ${instId}` })),
      ...loosePieceIds.map((id) => ({ event: { kind: 'pieceRemoved', id } as BuildEditEvent, label: `removed ${id}` })),
    ];
    if (!events.length) return;
    const whole = new Set(wholeInstances);
    const hide = new Set(loosePieceIds);
    for (const p of piecesRef.current) {
      const inst = buildingPieceInstanceId(p.id);
      if (inst && whole.has(inst)) hide.add(p.id);
    }
    setPendingDelete(hide);
    setSelectedIds(new Set());
    commitPerfRef.current = { t0: perfMs(), label: `delete (${hide.size} pieces, ${wholeInstances.length} buildings)` };
    setTimeout(() => { commitBatch(events); }, 0);
  };
  // Turn the selected wall(s) into a window/door/arch IN PLACE. A WallEdit is a
  // CUTOUT on the same slab (game/build/edits) — pieceShapes cuts the opening
  // from the wall's own bands, so the result is exactly flush and full-height.
  // This is why "delete the wall, drop a window-wall module" left a gap at the
  // bottom and sat recessed: that was a DIFFERENT, smaller piece re-snapped to
  // its own origin. Here the piece id, footprint, height, and skin all stay put
  // and only the cutout changes — the play-mode build editor's "E edit" verb
  // (pieceEditSet, PLACEDEDIT-0613), brought to the iso pane as a toolbar verb
  // because 'e' already orbits the camera in the iso-build control scope.
  const setCutoutOnSelection = (edit: WallEdit) => {
    const walls = piecesRef.current.filter((p) => selectedIdsRef.current.has(p.id) && GAME_BUILD.placed.acceptsEdits(p));
    if (!walls.length) return;
    commitBatch(walls.map((p) => ({
      event: { kind: 'pieceEditSet', id: p.id, edit } as BuildEditEvent,
      label: `${p.id}: cutout → ${edit}`,
    })));
  };
  // Duplicate the selection beside itself, shifted clear along +x by the
  // selection's own width. A whole BUILDING clones as ONE buildingPlaced of
  // the same def (req_0513 — the copy is its own instance, its own history
  // branch); everything else re-emits piecePlaced (the stream mints fresh ids).
  const cloneSelected = () => {
    const sel = piecesRef.current.filter((p) => selectedIdsRef.current.has(p.id));
    if (!sel.length) return;
    let minX = Infinity, maxX = -Infinity;
    for (const p of sel) { const b = GAME_BUILD.placed.bounds(p); minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX); }
    const dx = (maxX - minX) + state.world.cellSizeMeters;
    const { wholeInstances } = partitionBuildingSelection(selectedIdsRef.current, piecesRef.current);
    const whole = new Set(wholeInstances);
    const events: Array<{ event: BuildEditEvent; label: string }> = [];
    for (const instId of wholeInstances) {
      const inst = buildingsRef.current?.[instId];
      if (!inst) continue;
      events.push({ event: { kind: 'buildingPlaced', defId: inst.defId, x: inst.x + dx, y: inst.y, z: inst.z, yawDegrees: inst.yawDegrees }, label: `cloned building ${instId}` });
    }
    // Spread the whole piece (minus the stream-minted id) so each copy keeps its per-face
    // skin/materials and any wall edit — only the X position shifts. Give the WHOLE clone
    // one fresh stampId: that makes the copy its own independent building (so it gets the
    // flat-pad terrain lift as a unit) instead of a phantom member of the original's stamp.
    // One batch → one undo step, one snapshot.
    const cloneStampId = `clone-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    const clonedPlacements: Array<{ pieceId: string; x: number; y: number; z: number; yawDegrees: number }> = [];
    for (const p of sel) {
      const inst = buildingPieceInstanceId(p.id);
      if (inst && whole.has(inst)) continue; // cloned above as one instance
      const { id, ...rest } = p;
      const placement = { ...rest, x: p.x + dx, stampId: cloneStampId };
      clonedPlacements.push(placement);
      events.push({ event: { kind: 'piecePlaced', placement }, label: `cloned ${p.pieceId}` });
    }
    if (clonedPlacements.length) logPiecesPlaced(`iso clone (dx=${dx.toFixed(2)})`, clonedPlacements);
    commitBatch(events);
  };
  // Rotate the current selection with the SAME R key the placement ghost uses.
  // Whole buildings rotate as ONE buildingMoved with yaw; loose pieces use the
  // existing remove+place path so the shared world stream stays additive.
  const rotateSelected = () => {
    const ids = selectedIdsRef.current;
    if (!ids.size) return;
    const sel = piecesRef.current.filter((p) => ids.has(p.id));
    if (!sel.length) return;
    const { wholeInstances, partialInstances, loosePieceIds } = partitionBuildingSelection(ids, piecesRef.current);
    if (partialInstances.length) {
      console.warn(`[iso-author] rotate skipped ${partialInstances.length} partially-selected building(s) — select the whole building (▦ or shift-click)`);
      return;
    }
    const events: Array<{ event: BuildEditEvent; label: string }> = [];
    for (const instId of wholeInstances) {
      const inst = buildingsRef.current?.[instId];
      if (!inst) continue;
      events.push({
        event: { kind: 'buildingMoved', id: instId, x: inst.x, z: inst.z, yawDegrees: normalizeYawDegrees(inst.yawDegrees + 90) },
        label: `rotated building ${instId}`,
      });
    }
    const looseSet = new Set(loosePieceIds);
    const rotations = sel
      .filter((p) => looseSet.has(p.id))
      .map((p) => {
        const { id, ...rest } = p;
        return { id, placement: { ...rest, yawDegrees: normalizeYawDegrees(p.yawDegrees + 90) } };
      });
    if (rotations.some((r) => GAME_BUILD.placed.validatePlacement(r.placement).length > 0)) return;
    if (rotations.length) logPiecesPlaced('iso rotate', rotations.map((r) => r.placement));
    events.push(
      ...rotations.map((r) => ({ event: { kind: 'pieceRemoved', id: r.id } as BuildEditEvent, label: `rotated ${r.id}` })),
      ...rotations.map((r) => ({ event: { kind: 'piecePlaced', placement: r.placement } as BuildEditEvent, label: `rotated ${r.placement.pieceId}` })),
    );
    if (!events.length) return;
    // KEEP the selection across the rotation so R,R,R turns a thing 270°
    // without re-clicking (req_0645). Building piece ids survive buildingMoved;
    // loose pieces re-place under FRESH stream ids, so the dead ids drop now
    // and the reselect effect re-acquires them by placement signature once the
    // re-materialized pieces arrive.
    if (rotations.length) reselectRef.current = new Set(rotations.map((r) => pieceSignature(r.placement)));
    setSelectedIds((prev) => {
      const dead = new Set(rotations.map((r) => r.id));
      return new Set([...prev].filter((id) => !dead.has(id)));
    });
    commitBatch(events);
  };
  // PROMOTE (req_0513, slice 1): capture the selected loose pieces into a
  // BuildingDef + ONE placed instance, then remove the originals — one batch,
  // one undo step. The derived stamp reproduces the pieces exactly (same
  // positions, skins, edits), so the swap is visually seamless; from here on
  // the building owns its history and a move is ONE event.
  const promoteSelectionToBuilding = () => {
    const sel = piecesRef.current.filter((p) => selectedIdsRef.current.has(p.id));
    if (!sel.length) return;
    if (sel.some((p) => buildingPieceInstanceId(p.id) !== null)) {
      console.warn('[iso-author] promote skipped — the selection already contains a building');
      return;
    }
    const count = Object.keys(buildingsRef.current ?? {}).length;
    const capture = buildingDefFromPieces(`Building ${count + 1}`, sel);
    if (!capture) {
      console.warn('[iso-author] promote refused — the capture would not validate as a building def');
      return;
    }
    commitPerfRef.current = { t0: perfMs(), label: `promote (${sel.length} pieces)` };
    setSelectedIds(new Set());
    // No optimistic hide: the instance's derived pieces land at the originals'
    // exact poses, so the one-fold swap is invisible.
    setTimeout(() => {
      commitBatch([
        { event: { kind: 'buildingDefined', def: capture.def }, label: `defined ${capture.def.label}` },
        { event: { kind: 'buildingPlaced', defId: capture.def.id, x: capture.origin.x, y: capture.origin.y, z: capture.origin.z, yawDegrees: 0 }, label: `promoted ${sel.length} pieces → ${capture.def.label}` },
        ...sel.map((p) => ({ event: { kind: 'pieceRemoved', id: p.id } as BuildEditEvent, label: `promoted ${p.id}` })),
      ]);
    }, 0);
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
  // Overwrite an EXISTING prefab id from the current selection. This uses the
  // same prefabDefined upsert the building workspace uses, so the palette entry
  // keeps its identity while the semantic pieces underneath are replaced.
  const updatePrefabFromSelection = (targetId: string) => {
    const target = prefabByIdRef.current.get(targetId);
    if (!target) return;
    const sel = piecesRef.current.filter((p) => selectedIdsRef.current.has(p.id));
    if (!sel.length) return;
    const def = GAME_BUILD.placed.prefabFromPieces(target.id, target.label, target.theme, sel);
    onCommit({ kind: 'prefabDefined', def }, `updated prefab ${target.label}`);
  };
  // Commit a finished move drag: shift every selected piece by the dragged world delta.
  // A whole BUILDING moves as ONE buildingMoved event on its own history
  // branch (req_0513 — the user's "i am here at this position": no 358-event
  // remove+place storm, and the derived pieces keep their deterministic ids).
  // LOOSE pieces keep the remove+place pair (no pieceMoved event — that'd
  // touch the shared stream + F2 + compile). Validate all loose destinations
  // FIRST (intrinsic checks; not collision) and abort the whole move if any is
  // refused, so a building never lands half-shifted. A PARTIALLY-selected
  // building aborts the move loudly: tearing pieces off an instance is a
  // slice-2 edit, and faking it with no-op events would corrupt the world.
  const commitMove = () => {
    const delta = moveDeltaRef.current;
    if (!delta || (Math.abs(delta.dx) < 1e-3 && Math.abs(delta.dz) < 1e-3 && Math.abs(delta.dy) < 1e-3)) { setMoveDelta(null); return; }
    const sel = piecesRef.current.filter((p) => selectedIdsRef.current.has(p.id));
    if (!sel.length) { setMoveDelta(null); return; }
    const { wholeInstances, partialInstances, loosePieceIds } = partitionBuildingSelection(selectedIdsRef.current, piecesRef.current);
    if (partialInstances.length) {
      console.warn(`[iso-author] move aborted — ${partialInstances.length} building(s) only partially selected; select the whole building (▦ or shift-click)`);
      setMoveDelta(null);
      return;
    }
    const events: Array<{ event: BuildEditEvent; label: string }> = [];
    for (const instId of wholeInstances) {
      const inst = buildingsRef.current?.[instId];
      if (!inst) { setMoveDelta(null); return; } // instance vanished under us — abort whole
      events.push({ event: { kind: 'buildingMoved', id: instId, x: inst.x + delta.dx, z: inst.z + delta.dz }, label: `moved building ${instId}` });
    }
    // Spread the WHOLE piece (minus the stream-minted id) into the new placement so the
    // moved piece keeps its per-face skin/materials, wall edit, and prefab grouping —
    // only x/z shift. (The earlier slice copied just pieceId/pose, which stripped every
    // face material on move.)
    const looseSet = new Set(loosePieceIds);
    const loose = sel.filter((p) => looseSet.has(p.id));
    const moves = loose.map((p) => { const { id, ...rest } = p; return { id, placement: { ...rest, x: p.x + delta.dx, y: p.y + delta.dy, z: p.z + delta.dz } }; });
    if (moves.some((m) => GAME_BUILD.placed.validatePlacement(m.placement).length > 0)) { setMoveDelta(null); return; }
    // OPTIMISTIC (req_0511): release costs nothing — the move ghost (already
    // mounted) turns SOLID at the new spot, the originals hide, and the store
    // batch runs a tick later. moveDelta intentionally STAYS set so the ghost
    // keeps rendering; the [pieces] effect clears it when the world catches up.
    // The ghost renders from a SNAPSHOT of the selection (a moved building
    // keeps its derived ids, so the live displayPieces would double-shift it
    // for the catch-up frame).
    commitPerfRef.current = { t0: perfMs(), label: `move commit (${sel.length} pieces, ${wholeInstances.length} buildings)` };
    pendingMoveSnapRef.current = displayPiecesRef.current.filter((p) => selectedIdsRef.current.has(p.id));
    setPendingMove(new Set(sel.map((p) => p.id)));
    setSelectedIds(new Set());
    // One batch: building moves + (all removes then all places) → one undo
    // step, one store snapshot, so moving a whole building doesn't freeze.
    setTimeout(() => {
      logPiecesPlaced(`iso move (dx=${delta.dx.toFixed(2)} dy=${delta.dy.toFixed(2)} dz=${delta.dz.toFixed(2)})`, moves.map((m) => m.placement));
      commitBatch([
        ...events,
        ...moves.map((m) => ({ event: { kind: 'pieceRemoved', id: m.id } as BuildEditEvent, label: `moved ${m.id}` })),
        ...moves.map((m) => ({ event: { kind: 'piecePlaced', placement: m.placement } as BuildEditEvent, label: `moved ${m.placement.pieceId}` })),
      ]);
    }, 0);
  };
  // Commit a finished drag-paint: drop the previewed wall line / floor rect as ONE batch
  // (one undo step, one snapshot). Skip any cell the validator refuses so a partial run
  // still lands the valid pieces. OPTIMISTIC (req_0511): the painted cells stay
  // rendered (the ghost turns solid via pendingPaint) until the real pieces land.
  const commitPaint = () => {
    const cells = paintCellsRef.current;
    const a = armedRef.current;
    // Release-to-standing latency: the commitPerf effect prints when the pieces
    // prop reflects the commit (store snapshot + stream materialize + re-render).
    commitPerfRef.current = { t0: perfMs(), label: a?.kind === 'tower' ? 'tower commit' : 'paint commit' };
    if (a?.kind === 'tower') {
      // The preview showed the ground ring; commit the FULL shell from the drag
      // corners. The ring stays as the optimistic overlay while the shell lands.
      const rect = towerDragRef.current;
      towerDragRef.current = null;
      if (rect) {
        setPendingPaint(true);
        setTimeout(() => commitTower(rect.start, rect.end), 0);
      } else {
        setPaintCells(null);
        commitPerfRef.current = null;
      }
      return;
    }
    if (!cells || !cells.length) { setPaintCells(null); commitPerfRef.current = null; return; }
    const valid = cells.filter((c) => GAME_BUILD.placed.validatePlacement(c).length === 0);
    if (!valid.length) { setPaintCells(null); commitPerfRef.current = null; return; }
    const label = a && a.kind === 'piece' ? GAME_BUILD.catalog.get(a.id).label : 'piece';
    setPendingPaint(true);
    setTimeout(() => {
      // placementFor injects the row's defaultEdit (REQ-0647) so a drag-painted
      // run of Window Walls lands with every pane cut, like a single click. A
      // roof drag carries its dragged footprint (roofSpan, req_0917) through —
      // placementFor only knows the row + pose, so re-attach it here.
      const placements = valid.map((c) => ({
        ...GAME_BUILD.placed.placementFor(GAME_BUILD.catalog.get(c.pieceId), c),
        ...(c.roofSpan ? { roofSpan: c.roofSpan } : {}),
      }));
      logPiecesPlaced('iso drag-paint', placements);
      commitBatch(placements.map((placement) => ({
        event: { kind: 'piecePlaced', placement } as WorldEvent,
        label: `painted ${label}`,
      })));
    }, 0);
  };
  // Latest delete/clone closures, so the once-mounted key listener always calls the
  // current ones (they read live refs + the current onCommit).
  const keyActionsRef = useRef({ deleteSelected, cloneSelected, rotateSelected, recenter, saveCamera });
  keyActionsRef.current = { deleteSelected, cloneSelected, rotateSelected, recenter, saveCamera };

  // Keys (while focused) ride the EDITOR CONTROL CONTRACT (editors/controls.ts,
  // EDITORCTL-0610): the 'iso-build' scope table IS the bindings; this hook
  // only supplies the verbs. The contract owns chord matching and the typing
  // gate (which this pane previously lacked — R in a text field rotated).
  const heldPanRef = useRef<Record<string, boolean>>({});
  useEditorControls('iso-build', {
    active: !!props.focused,
    handlers: {
      'selection.rotate': () => {
        lastInputAtRef.current = (globalThis as any).performance?.now?.() ?? 0;
        // A live selection wins R (req_0645 "i can only rotate before place"):
        // you clicked a thing — R turns THAT, armed ghost or not. No selection
        // and a piece armed → R turns the placement ghost, as ever.
        if (selectedIdsRef.current.size) keyActionsRef.current.rotateSelected();
        else if (armedRef.current) setGhostYaw((y) => (y + 90) % 360);
      },
      'selection.cancel': () => { setArmed(null); setSelectedIds(new Set()); },
      'camera.orbit-ccw': () => { stage.rotate(-1); pushNativeCamera(); keyActionsRef.current.saveCamera(); },
      'camera.orbit-cw': () => { stage.rotate(1); pushNativeCamera(); keyActionsRef.current.saveCamera(); },
      'view.recenter': () => keyActionsRef.current.recenter(),
      'selection.delete': () => keyActionsRef.current.deleteSelected(),
      'view.pan': ({ phase, key }) => {
        const k = ARROW_TO_WASD[key] ?? key;
        if (phase === 'down') {
          heldPanRef.current[k] = true;
          lastInputAtRef.current = (globalThis as any).performance?.now?.() ?? 0;
        } else {
          heldPanRef.current[k] = false;
          keyActionsRef.current.saveCamera();
        }
      },
    },
  });

  // The held-key pan loop: WASD/arrows slide the view across the ground. Speed
  // scales with the eye distance so a keystroke crosses the same fraction of the
  // view at every zoom. The loop only runs while this pane is focused; the held
  // set is written by the contract dispatcher above.
  useEffect(() => {
    if (!props.focused) return;
    heldPanRef.current = {}; // a refocus starts with nothing held
    const held = heldPanRef.current;
    const G: any = globalThis;
    const sched = G.requestAnimationFrame ? G.requestAnimationFrame.bind(G) : (fn: any) => setTimeout(fn, 16);
    const cancel = G.cancelAnimationFrame ? G.cancelAnimationFrame.bind(G) : clearTimeout;
    let handle: any = 0;
    let last = G.performance?.now?.() ?? 0;
    let alive = true;
    // Stall-warn aggregation (req_0507): a sustained slow window (e.g. the dev
    // watcher re-bundling during a burst of agent file saves) printed one line
    // PER FRAME and flooded the console. Aggregate to at most one line per
    // second: count + worst gap in the window — same signal, readable.
    let stallWindowAt = 0;
    let stallCount = 0;
    let stallMax = 0;
    const tick = () => {
      if (!alive) return;
      const now = G.performance?.now?.() ?? last + 16;
      // Frame-stall watchdog (req_0502): this loop reschedules itself every
      // frame, so a long gap between ticks IS a main-thread stall — JS work we
      // haven't probed, or the host frame choking — exactly the time the
      // commit probes can't see.
      // IDLE vs INTERACTION (req_0516, USER: "why does this fire when im
      // doing nothing at all?"): the loop ticks even when the user is idle,
      // so EXTERNAL machine load (agent-side builds/verify suites, the dev
      // watcher re-bundling) also lands here — real starvation, but NOT the
      // user's drag. Stalls outside an interaction window (no drag, no
      // pending commit, no input for 3s) say so on the line and report at
      // most once per 10s; interaction stalls keep req_0507's 1/s cadence.
      // SUSPEND vs STALL (req_1634, USER report of "max=52494ms"): performance.now()
      // counts wall-clock across process suspension, so when the machine sleeps or
      // the host is paused, the very next tick shows a multi-second gap. That is not
      // a frame stall — it's a clock jump — and reporting it as one is cry-wolf
      // noise. Absorb any gap past a sane ceiling: advance the clock and skip the
      // watchdog entirely for this tick (dt is already clamped to 0.05 below, so the
      // simulation never lurches on resume).
      if (now - last > 4000) {
        last = now;
        handle = sched(tick);
        return;
      }
      if (now - last > 150) {
        const idle = !dragRef.current && !commitPerfRef.current && now - lastInputAtRef.current > 3000;
        stallCount += 1;
        if (now - last > stallMax) stallMax = now - last;
        if (now - stallWindowAt > (idle ? 10000 : 1000)) {
          console.warn(`[DRAGDRAW] frame stall${stallCount > 1 ? `s ×${stallCount}` : ''} max=${stallMax.toFixed(0)}ms${commitPerfRef.current ? ` after=${commitPerfRef.current.label}` : ''}${idle ? ' (idle — external load on this machine, e.g. builds/bundler; not your editing)' : ''}`);
          stallWindowAt = now;
          stallCount = 0;
          stallMax = 0;
        }
      }
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      // Orphaned-gesture watchdog (req_0517: a giant stale paint ghost sat
      // where the user dragged earlier, suppressing the real one-tile hover
      // ghost — "the behavior of the placement tool pre placement is being a
      // pain"). The engine pointer-captures the drag to this pane, but a few
      // release paths eat the dispatch BEFORE capture fires (render-surface
      // forwarding, chrome drag, an off-window release) — the pane never
      // hears mouse-up, so dragRef + paintCells/moveDelta stay stuck and the
      // [pieces] effect refuses to clear them (it must not clear a LIVE
      // drag). The engine still flips its button state FIRST on every
      // BUTTON_UP, so getMouseDown() is reliable truth: a drag whose button
      // has read UP for ~250ms is orphaned — CANCEL it (never commit; a
      // release this pane never saw must not place pieces).
      if (dragRef.current) {
        const buttonDown = Number(G.getMouseDown?.() ?? 1) !== 0;
        if (buttonDown) {
          orphanSinceRef.current = 0;
        } else if (!orphanSinceRef.current) {
          orphanSinceRef.current = now;
        } else if (now - orphanSinceRef.current > 250) {
          orphanSinceRef.current = 0;
          dragRef.current = null;
          dragPerfRef.current = null;
          towerDragRef.current = null;
          paintSigRef.current = '';
          setPaintCells(null);
          setMoveDelta(null);
          console.warn('[iso-author] drag canceled — its release never reached this pane (req_0517)');
        }
      } else {
        orphanSinceRef.current = 0;
      }
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
    return () => { alive = false; cancel(handle); };
  }, [props.focused, stage, redraw]);

  const level = stage.pose.level;

  // The placement ghost: the armed piece drawn translucent at the snapped pose,
  // tinted blocked-red when validatePlacement refuses it — F2's ghost, in iso.
  const ghostMeshes = useMemo(() => {
    const a = armedRef.current;
    if (!a || !snap) return null;
    if (paintCells && paintCells.length) return null; // the paint line/rect ghost owns the preview
    if (a.kind === 'water') return null; // water drops on click; no piece ghost
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
      // placementFor previews the row's defaultEdit (REQ-0647) — a Doorway
      // Wall ghost shows its cut before it lands, same as F2's ghost.
      : [GAME_BUILD.placed.placementFor(GAME_BUILD.catalog.get(a.id), { x: snap.placement.x, y: snap.placement.y, z: snap.placement.z, yawDegrees: yaw })];
    const blocked = a.kind === 'piece' && GAME_BUILD.placed.validatePlacement(previews[0] as any).length > 0;
    const color = blocked ? BUILD_UI.ghostBlockedColor : BUILD_UI.ghostColor;
    const supportPieces = [...displayPieces, ...previews.map((p, i) => ({ id: `isoGhost${i}`, ...p }))];
    return previews.map((p, i) => (
      <GhostPiece key={i} piece={p} ghostKey={`isoGhost${i}`} supportPieces={supportPieces} colorOverride={color} opacityOverride={BUILD_UI.ghostOpacity} blocked={blocked} />
    ));
  }, [snap, armed, prefabById, paintCells, displayPieces]);

  // The move preview: the selected pieces drawn translucent at the dragged offset while
  // a move drag is live, tinted blocked-red if any destination fails validation — the
  // same ghost language placement uses, so a move reads like a re-place. After release
  // (pendingMove) the SAME ghost nodes turn SOLID with their real skins — they ARE the
  // building until the standing world catches up, so confirm is a prop swap.
  const moveGhostMeshes = useMemo(() => {
    if (!moveDelta) return null;
    const ids = pendingMove ?? selectedIds;
    // Preview from the DRAWN (terrain-lifted) pieces so the ghost rides the terrain where
    // the building currently stands; the committed move re-lifts at the drop spot. After
    // release the ghost reads the commit-time SNAPSHOT (see pendingMoveSnapRef).
    const sel = pendingMove !== null ? pendingMoveSnapRef.current : displayPieces.filter((p) => ids.has(p.id));
    if (!sel.length) return null;
    // Carry skin + edit so the solid pending look matches the real building.
    const moved = sel.map((p) => ({ pieceId: p.pieceId, x: p.x + moveDelta.dx, y: p.y + moveDelta.dy, z: p.z + moveDelta.dz, yawDegrees: p.yawDegrees, skin: p.skin, edit: p.edit }));
    const solid = pendingMove !== null;
    const blocked = !solid && moved.some((m) => GAME_BUILD.placed.validatePlacement(m as any).length > 0);
    const color = solid ? undefined : blocked ? BUILD_UI.ghostBlockedColor : BUILD_UI.ghostColor;
    const opacity = solid ? undefined : BUILD_UI.ghostOpacity;
    const supportPieces = [
      ...displayPieces.filter((p) => !ids.has(p.id)),
      ...moved.map((m, i) => ({ id: `isoMove${i}`, ...m })),
    ];
    return moved.map((m, i) => (
      <GhostPiece key={i} piece={m} ghostKey={`isoMove${i}`} supportPieces={supportPieces} colorOverride={color} opacityOverride={opacity} blocked={blocked} />
    ));
  }, [moveDelta, displayPieces, selectedIds, pendingMove]);

  // The drag-paint preview: every wall in the line / floor in the rect drawn translucent,
  // each tinted blocked-red if the validator refuses it. After release (pendingPaint)
  // the SAME ghost cells turn SOLID with their real catalog look — the wall reads as
  // placed instantly while the store batch lands behind the confirming pill.
  const paintGhostMeshes = useMemo(() => {
    if (!paintCells || !paintCells.length) return null;
    const t0 = perfMs();
    const solid = pendingPaint;
    // ONE support array shared by every cell (PLACEPERF-0610): pieceGridOf caches
    // the spatial grid on the pieces ARRAY identity, so building this inside the
    // flatMap (a fresh array per cell) forced an O(N) grid rebuild per cell, per
    // mouse-move — the drag-draw lag. Hoisted, all cells share one cached grid.
    const supportPieces = [...displayPieces, ...paintCells.map((p, j) => ({ id: `isoPaint${j}`, ...p }))];
    const ghosts = paintCells.map((c, i) => {
      const blockedCell = !solid && GAME_BUILD.placed.validatePlacement(c).length > 0;
      const color = solid ? undefined : blockedCell ? BUILD_UI.ghostBlockedColor : BUILD_UI.ghostColor;
      return (
        <GhostPiece key={i} piece={c} ghostKey={`isoPaint${i}`} supportPieces={supportPieces} colorOverride={color} opacityOverride={solid ? undefined : BUILD_UI.ghostOpacity} blocked={blockedCell} />
      );
    });
    const ghostMs = perfMs() - t0;
    warnPlaceFreeze('paintGhost', { cells: paintCells.length, pieces: displayPieces.length, ms: ghostMs });
    const perf = dragPerfRef.current;
    if (perf) {
      perf.ghostTotal += ghostMs;
      if (ghostMs > perf.ghostMax) perf.ghostMax = ghostMs;
    }
    return ghosts;
  }, [paintCells, displayPieces, pendingPaint]);

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
    // The cut plane is TERRAIN-RELATIVE (req_0639): a piece's storey is its
    // height above the ground it STANDS ON, not its absolute world y. Cutting
    // on the lifted world y hid anything seated on a painted hill taller than
    // the cut the moment it committed (the radio-tower-on-a-hill vanish —
    // ghost previews fine, the placed piece lands in this filter). A hilltop
    // is still floor 0 up there.
    // Optimistic edits also hide here: a pending move's ORIGINALS vanish (the
    // solid ghost holds the building at its new spot), a pending delete's
    // pieces vanish this frame — both before the store batch lands.
    const visible = displayPieces.filter((p) =>
      (showAllFloors || p.y - groundTopAt(p.x, p.z) < cut)
      && (wallsVisible || !isWallPiece(p))
      && !pendingMove?.has(p.id)
      && !pendingDelete?.has(p.id));
    return visible.length === displayPieces.length ? displayPieces : visible;
  }, [displayPieces, groundTopAt, level, pendingMove, pendingDelete, wallsVisible, showAllFloors]);
  const visiblePiecesRef = useRef(visiblePieces);
  visiblePiecesRef.current = visiblePieces;

  // Memoize the STATIC scene content — the world meshes (terrain/landforms/props) and
  // the texture-capture mounts — so a camera-only redraw doesn't re-run and reconcile
  // the whole world every tick. Drag-rotate fires a redraw per mouse-move; without this
  // a 360° spin re-built the entire terrain/landform/prop tree dozens of times a second
  // and choked. Only a real world/skin change rebuilds these; camera + grid + pieces +
  // ghost stay live below.
  const worldStatics = useMemo(() => (
    <WorldStatics world={state.world} skyConfig={state.config.sky} showFlora={floraVisible} />
  ), [state.world, state.config.sky, floraVisible]);
  const sceneCaptures = useMemo(() => (
    <>
      <LandformSurfaceCaptures landforms={state.world.landforms ?? []} />
      <PropSurfaceCaptures props={state.world.props} />
      {/* click-to-pick PART textures (WorldProp.partTextures / Building.partTextures)
          — bakes the texture each textured prop/structure part samples, so the iso
          build pane wears them. Covers both the world's props AND the placed PROP
          PIECES (PROPSKIN-0766: a prop piece skinned in the PAINT panel). Empty
          until a part is textured → zero cost. */}
      <WorldPartCaptures buildings={state.world.buildings} props={[...state.world.props, ...texturedPropsFromPieces(pieces)]} perception={state.player.perception} />
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
  ), [state.world.landforms, state.world.props, state.world.buildings, pieces, skinIds, state.player.perception]);
  const armedPropCanFreeform = armed?.kind === 'piece' && GAME_BUILD.catalog.get(armed.id).kind === 'prop';
  const selectedPropsCanFreeform = useMemo(() => selectionIsOnlyProps(selectedIds, pieces), [selectedIds, pieces]);
  // REQ-0647: each shaft's car parked at its bottom stop (no ride loop here).
  const restElevatorCarMeshes = useMemo(() => GAME_BUILD.elevators.shafts(visiblePieces).map((shaft) => (
    <VisualShapeMesh
      key={`${shaft.key}.car`}
      shape={elevatorCarVisualShape(GAME_BUILD.elevators.carBox(shaft, shaft.stops[0]), `${shaft.key}.car`)}
    />
  )), [visiblePieces]);

  return (
    <Box
      onLayout={(lr: any) => {
        rectRef.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height };
        // [iso-rect req_1747] TEMP: the build-pane 3D View only renders when its
        // Box has real area — log the measured size so a 0/NaN/huge size (→ Scene3D
        // never painted → drawScene never runs → blank) is visible. Remove once fixed.
        console.warn(`[iso-rect] x=${lr.x} y=${lr.y} w=${lr.width} h=${lr.height}`);
      }}
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
        {/* REQ-0647: elevator cars at their REST stop — the iso pane has no
            ride loop, so it shows each shaft's car parked at the bottom storey
            (same carBox source the play route animates). */}
        {restElevatorCarMeshes}
        {ghostMeshes}
        {moveGhostMeshes}
        {paintGhostMeshes}
        {/* tile-lookup highlight (req_0823): a magenta marker on the exact looked-up
            cell, raised so it reads over the ground. Position = cell CENTRE in world
            metres ((g+0.5)*cellSize), the same mapping the ground mesh uses. */}
        {lookupCell ? (
          <>
            {/* flat magenta cap exactly over the one cell */}
            <Scene3D.Mesh
              geometry={Geometry.Box}
              params={{ width: 1, height: 1, depth: 1 }}
              scale={[(state.world.cellSizeMeters || 1), 0.3, (state.world.cellSizeMeters || 1)]}
              position={[(lookupCell.gx + 0.5) * (state.world.cellSizeMeters || 1), level * METERS_PER_LEVEL + 0.15, (lookupCell.gz + 0.5) * (state.world.cellSizeMeters || 1)]}
              material="#ff2bd6"
            />
            {/* tall beacon so the cell is findable from any zoom/angle */}
            <Scene3D.Mesh
              geometry={Geometry.Box}
              params={{ width: 1, height: 1, depth: 1 }}
              scale={[0.35, 40, 0.35]}
              position={[(lookupCell.gx + 0.5) * (state.world.cellSizeMeters || 1), level * METERS_PER_LEVEL + 20, (lookupCell.gz + 0.5) * (state.world.cellSizeMeters || 1)]}
              material="#ff2bd6"
            />
          </>
        ) : null}
      </Scene3D>

      {/* pointer capture (near-transparent so it's hittable). onScroll rides the raw
          wheel delta (events.zig) — zoom toward the cursor, map-style. */}
      <Pressable
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onScroll={(e: any) => {
          markInput();
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

      {/* ── confirming pill (req_0511): an optimistic edit is resolving behind
          the scenes — the user is never in a delayed state, this just says so */}
      {pendingAny ? (
        <Box style={{ position: 'absolute', left: 8, top: 8, paddingLeft: 8, paddingRight: 8, paddingTop: 3, paddingBottom: 3, borderRadius: 4, backgroundColor: '#3a2f12ee', borderWidth: 1, borderColor: '#a16207' }}>
          <Text fontSize={9} color="#fbbf24" style={{ fontFamily: 'monospace' }}>confirming…</Text>
        </Box>
      ) : null}

      {/* ── tile lookup (req_0823): type an address, highlight that exact tile.
          Sits under the top-right control cluster so it never covers the
          bottom/left editor panels. */}
      <Box style={{ position: 'absolute', right: 8, top: 40, flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: '#0b1220ee', borderWidth: 1, borderColor: '#1e3a5f', borderRadius: 6, paddingLeft: 8, paddingRight: 8, paddingTop: 5, paddingBottom: 5 }}>
        <Text fontSize={10} color="#7dd3fc" style={{ fontFamily: 'monospace' }}>tile</Text>
        <TextInput
          text={lookupAddr}
          onChangeText={(v: string) => {
            setLookupAddr(v);
            const p = parseAddress(v.trim());
            setLookupCell(p ? { gx: p.x, gz: p.z } : null);
            if (p) { // fly the iso camera to the tile so the beacon is on-screen
              const cs = state.world.cellSizeMeters || 1;
              stage.centerOn((p.x + 0.5) * cs, (p.z + 0.5) * cs);
              redraw();
              saveCamera();
            }
          }}
          style={{ width: 84, backgroundColor: '#0f1a2e', borderWidth: 1, borderColor: '#27364a', borderRadius: 4, paddingLeft: 6, paddingRight: 6, paddingTop: 4, paddingBottom: 4, color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace' }}
        />
        <Text fontSize={10} color="#cbd5e1" style={{ fontFamily: 'monospace' }}>
          {lookup ? `${cellAddress(lookup.gx, lookup.gz)} (${lookup.gx},${lookup.gz}) ch ${lookup.cx},${lookup.cz} · data=${lookup.kind} · shader-reads=${lookup.shaderKind}` : 'e.g. EI120'}
        </Text>
      </Box>

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
        <IsoBtn label="⌷" active={!showAllFloors} title={showAllFloors ? 'Showing ALL floors — click to cut away to the active floor (F)' : 'Cut-away ON (showing up to the active floor) — click to show ALL floors'} onPress={() => setShowAllFloors((v) => !v)} />
        <IsoBtn label={wholeBuilding ? '▦' : '▪'} title={wholeBuilding ? 'Select: whole building · Shift-click = one piece' : 'Select: one piece · Shift-click = whole building'} onPress={() => setWholeBuilding((v) => !v)} />
        <IsoBtn label="W" active={!wallsVisible} title={wallsVisible ? 'Hide walls in this iso view' : 'Show walls in this iso view'} onPress={() => setWallsVisible((v) => !v)} />
        <IsoBtn label="Fl" active={!floraVisible} title={floraVisible ? 'Hide flora in this iso view' : 'Show flora in this iso view'} onPress={() => setFloraVisible((v) => !v)} />
        {selectedIds.size > 0 ? (
          <>
            <IsoBtn label="⊞" title="Save selection as a prefab" onPress={() => setPrefabNameDraft(nextCustomName())} />
            <IsoBtn label="↻" title="Update an existing prefab from selection" onPress={() => setPrefabUpdateOpen(true)} />
            <IsoBtn label="⌂+" title="Promote selection to a BUILDING — it owns its history; moves become one event" onPress={promoteSelectionToBuilding} />
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

      {/* ── cutout on the selected wall (req_1292/1293): a window or door is a
          CUTOUT applied to the wall IN PLACE, never a separate "window-wall"
          module. Swapping in a different module re-snapped it to its own origin
          and shrank it — that was the gap at the bottom and the recessed face.
          pieceEditSet keeps the same slab and just cuts the opening, so it stays
          flush and full-height. Shows the shared cutout as active. ─────────── */}
      {(() => {
        const walls = pieces.filter((p) => selectedIds.has(p.id) && GAME_BUILD.placed.acceptsEdits(p));
        if (!walls.length) return null;
        const first = walls[0].edit ?? 'solid';
        const shared = walls.every((p) => (p.edit ?? 'solid') === first) ? first : null;
        return (
          <Box style={{ position: 'absolute', left: 8, top: 64, flexDirection: 'row', flexWrap: 'wrap', gap: 4, maxWidth: 470, alignItems: 'center' }}>
            <Box style={{ paddingLeft: 6, paddingRight: 6, paddingTop: 4, paddingBottom: 4, backgroundColor: BUILD_UI.panelBg, borderRadius: 4 }}>
              <Text fontSize={10} color="#cbd5e1" style={{ fontFamily: 'monospace' }}>{`cutout · ${walls.length} wall${walls.length === 1 ? '' : 's'}`}</Text>
            </Box>
            {GAME_BUILD.edits.wallEdits.map((e) => (
              <Pressable key={e} onPress={() => setCutoutOnSelection(e)} hoverable tooltip={GAME_BUILD.edits.wall[e].meaning}>
                <Box style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 3, paddingBottom: 3, borderRadius: 4, backgroundColor: shared === e ? '#12324f' : BUILD_UI.panelBg, borderWidth: shared === e ? 1 : 0, borderColor: '#38bdf8' }}>
                  <Text fontSize={10} color={shared === e ? '#7dd3fc' : '#cbd5e1'} style={{ fontFamily: 'monospace' }}>{GAME_BUILD.edits.wall[e].label}</Text>
                </Box>
              </Pressable>
            ))}
          </Box>
        );
      })()}

      {/* face painter: NOT here anymore (req_0702) — it fills the cart's top-right
          PAINT tab, fed by the onSelectionChange mirror above. The map stays clear. */}

      {/* The catalog rail lives in the EDITOR rail now (req_1888) — OFF the map. */}

      <Text fontSize={9} color={props.focused ? '#7dd3fc' : '#475569'} style={{ fontFamily: 'monospace', position: 'absolute', left: 8, top: 34 }}>
        {armed
          ? armed.kind === 'tower'
            ? `tower: drag the footprint · ${towerFloors} floors (+/− top right) · hollow shell + roof, one building · Esc`
            : armed.kind === 'water'
              ? `water: ${WATER_BODY_PRESETS[armed.id]?.label ?? armed.id} · click the ground to drop a body of water · dig under it (Height brush) for a deeper pool · Esc`
              : `place: ${(armed.kind === 'prefab' ? prefabById.get(armed.id)?.label ?? armed.id : GAME_BUILD.catalog.get(armed.id).label)} · click to place${armedPropCanFreeform ? ' · Alt freeform' : ''}${paintKindOf(armed) === 'wall' ? ' · drag = wall line' : paintKindOf(armed) === 'floor' ? ' · drag = floor area' : paintKindOf(armed) === 'roof' ? ' · drag = roof over base' : ' · drag rotate'} · R rotate · shift-click select · Esc`
          : selectedIds.size > 0
            ? `${selectedIds.size} selected · drag to move${selectedPropsCanFreeform ? ' · Alt-drag freeform · Ctrl-drag height' : ''} · R rotate · wall? cut a window/door top-left · paint in the PAINT panel above · ⧉ clone · ✕/Del remove · ${wholeBuilding ? 'building' : 'one piece'} (shift inverts)`
            : `WASD pan · drag rotate · scroll zoom · F recenter · click = ${wholeBuilding ? 'building, shift = piece' : 'piece, shift = building'} · ${wallsVisible ? 'walls shown' : 'walls hidden'} · pick below to build`}
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
      {prefabUpdateOpen ? (
        <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#00000099' }}>
          <Box style={{ width: 420, maxWidth: '90%', backgroundColor: '#0b1220', borderWidth: 1, borderColor: '#1e3a5f', borderRadius: 8, padding: 14, gap: 10 }}>
            <Text fontSize={12} color="#7dd3fc" style={{ fontFamily: 'monospace', fontWeight: 700 }}>Update prefab from selection</Text>
            <Text fontSize={10} color="#94a3b8" style={{ fontFamily: 'monospace' }}>{`${selectedIds.size} selected · choose the prefab definition to overwrite`}</Text>
            <Box style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {prefabs.map((def) => (
                <Pressable key={def.id} onPress={() => { updatePrefabFromSelection(def.id); setPrefabUpdateOpen(false); }}>
                  <Box style={{ paddingLeft: 9, paddingRight: 9, paddingTop: 6, paddingBottom: 6, borderRadius: 5, borderWidth: 1, borderColor: '#3a4f6b', backgroundColor: '#16233a' }}>
                    <Text fontSize={11} color="#dbe6f3" style={{ fontFamily: 'monospace' }}>{def.label}</Text>
                  </Box>
                </Pressable>
              ))}
            </Box>
            <Box style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
              <Pressable onPress={() => setPrefabUpdateOpen(false)}>
                <Box style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6, borderRadius: 5, backgroundColor: '#1e293b' }}>
                  <Text fontSize={11} color="#a8b6c8" style={{ fontFamily: 'monospace' }}>Cancel</Text>
                </Box>
              </Pressable>
            </Box>
          </Box>
        </Box>
      ) : null}
    </Box>
  );
});

function IsoBtn(props: { label: string; onPress: () => void; title?: string; active?: boolean }) {
  // The icons are cryptic, so each carries a hover tooltip — the engine-native one
  // (hoverable + tooltip, painted by framework/tooltip.zig as an overlay), the same
  // door cart/testing_carts/tooltip_test.tsx exercises. No layout shift here: the
  // cluster is an absolutely-positioned overlay, and the tooltip paints over the scene.
  return (
    <Pressable onPress={props.onPress} hoverable={props.title ? true : undefined} tooltip={props.title}>
      <Box style={{ width: 26, height: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: props.active ? '#12324f' : BUILD_UI.panelBg, borderRadius: 4, borderWidth: props.active ? 1 : 0, borderColor: '#38bdf8' }}>
        <Text fontSize={12} color={props.active ? '#7dd3fc' : '#cbd5e1'}>{props.label}</Text>
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
type RailTab = BuildPieceKind | 'prefabs' | 'water';
const RAIL_TABS: RailTab[] = [...PALETTE_KINDS, 'prefabs', 'water'];
export const CatalogRail = memo(function CatalogRail(props: { armed: Armed; prefabs: readonly BuildPrefabDef[]; onArm: (a: NonNullable<Armed>) => void }) {
  // TWIGS (req_0643 "annoying have it reset"): the rail's tab + prop shelf are
  // route twig state, so a hot reload restores the menu where you left it —
  // the TWIGSWEEP-0610 rule, applied here.
  const [tab, setTab] = useRouteTwigState<RailTab>(ISO_ROUTE, 'railTab', 'wall');
  // The prop tab is SHELVED (PROPSHELF-0611, req_0636): ~100 kinds as one flat
  // button wall was unusable, so a second chip row picks a registry category
  // (game/kinds/props PROP_CATEGORIES) and only that shelf's pieces list.
  const [propShelf, setPropShelf] = useRouteTwigState<PropCategory>(ISO_ROUTE, 'railShelf', 'street');
  // Studio-cooked props (req_1134): subscribing here boot-syncs the cooked-prop
  // overlay (so a cold-loaded editor lists them) AND re-renders the rail when a
  // new asset is cooked. The cooked props live on the 'studio' shelf.
  const cooked = useCookedAssets();
  const cookedPropCount = cooked.byKind('prop').length;
  // 'prefabs' lists the named compositions (stamp → many pieces) — the FULL list the cart
  // passes (built-in + user-captured stream prefabs); every other tab lists that kind's
  // catalog pieces. Both feed the SAME rail, fed by the SAME GAME_BUILD.
  const entries = useMemo<{ id: string; label: string }[]>(
    () => {
      if (tab === 'prefabs') return props.prefabs.map((d) => ({ id: d.id, label: d.label }));
      if (tab === 'water') return WATER_BODY_PRESET_IDS.map((id) => ({ id, label: WATER_BODY_PRESETS[id].label }));
      const all = GAME_BUILD.catalog.byKind(tab);
      if (tab !== 'prop') return all;
      return all.filter((e) => {
        const kind = e.id.startsWith('prop.') ? e.id.slice('prop.'.length) : e.id;
        return isPropKind(kind) && propCategory(kind) === propShelf;
      });
    },
    [tab, propShelf, props.prefabs, cookedPropCount],
  );
  const armKind: 'piece' | 'prefab' | 'water' = tab === 'prefabs' ? 'prefab' : tab === 'water' ? 'water' : 'piece';
  const armedId = props.armed && props.armed.kind !== 'tower' ? props.armed.id : null;
  const towerArmed = props.armed?.kind === 'tower';
  return (
    <Box style={{ width: '100%', height: '100%', flexDirection: 'column', backgroundColor: '#0b1220fa', borderRadius: 6, borderWidth: 1, borderColor: '#1e3a5f', padding: 8, gap: 6 }}>
      <Text fontSize={10} color="#7dd3fc" style={{ fontFamily: 'monospace', fontWeight: 700 }}>
        {`${tab === 'prefabs' ? 'PREFABS' : tab === 'water' ? 'WATER' : 'PIECES'} · ${tab} (${entries.length})`}
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
      {/* PROPS get the PICTURE browser (req_1895): search across every category +
          paged thumbnails, off the pill wall. Other tabs keep the compact pill list. */}
      {tab === 'prop' ? (
        <PropBrowser armedId={armedId} onArm={(id) => props.onArm({ kind: 'piece', id })} />
      ) : (
        <ScrollView style={{ flexGrow: 1, minHeight: 0 }}>
          <Box style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap' }}>
            {entries.map((def) => (
              <Pressable key={def.id} onPress={() => props.onArm({ kind: armKind, id: def.id })}>
                <Box style={{ paddingLeft: 9, paddingRight: 9, paddingTop: 6, paddingBottom: 6, borderRadius: 5, borderWidth: 1, borderColor: armedId === def.id ? '#7dd3fc' : '#3a4f6b', backgroundColor: armedId === def.id ? '#1d4ed8' : '#16233a' }}>
                  <Text fontSize={11} color={armedId === def.id ? '#ffffff' : '#dbe6f3'} style={{ fontFamily: 'monospace' }}>{def.label}</Text>
                </Box>
              </Pressable>
            ))}
          </Box>
        </ScrollView>
      )}
    </Box>
  );
});
