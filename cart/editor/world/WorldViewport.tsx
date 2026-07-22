// WorldViewport — the editor-owned iso world viewport. A thin pane over host
// doors, nothing else:
//
//   render   — the native WorldLoader primitive (world_loader.zig) draws the baked
//              world + the live map-paint layer; JS never touches a mesh.
//   camera   — the cloned IsoStage solves the Sims-style pose; ONLY the 8-float
//              pose crosses per interaction (__compiled_world_set_camera).
//   place    — clicks grid-snap the armed piece, the HOST validates
//              (__game_build_validate via runtime/game/build.ts), and the placed
//              list re-packs into the live overlay (__compiled_world_set_live_pieces).
//   paint    — while the Map Paint tool is armed, the host claims the pointer
//              (__compiled_world_set_paint_mode) — zero JS per dab.
//   floors   — the ACTIVE LEVEL is a prop; the workspace action bar is the one
//              control (req_2485 — the floating Ground chip died with the old pane).
//
//   select   — off the Place tool, a click host-raycasts the catalog pieces
//              (pickBuildPieceHostHit) and slab-tests authored (model:) pieces in
//              JS (pickAuthoredPlacement — the static catalog can't index them);
//              nearest hit wins. The viewport is MODAL — the armed tool owns the
//              click (req_2550).
//
// Deliberately not here: host-owned build logic, prefab stamping, and residency
// beyond the local snapped Move drag. Each arrives through a strict host door.
import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { Box, Graph, Pressable } from '@reactjit/primitives';
import { IsoStage, METERS_PER_LEVEL, type Rect } from './isoStage';
import { resolvePlacement, resolveMovedPlacement, resolveRunPlacements, supportsRunPlacement, pieceKindOf, pieceLook, pickAuthoredPlacement, PIECE_MODULE_METERS, type ArmedPiece, type PlacedPiece, type PlacementGesture } from './pieces';
import { encodeMeshGhost } from './meshProps';
import { isAuthoredPiece, authoredResidentKeyOf, type AuthoredBuildPiece } from './authoredRegistry';
import { pushLiveWorld, pushResidentMeshes } from './livePush';
import { pickBuildPieceHostHit } from '../../../runtime/game/build';
import { faceRoleForHit } from './pieceSlots';
import { stickerLocalFrom } from './pieceSkins';
import { ensureMapSeeded } from '../stage/mapPaint';
import type { MapZoneDef } from '../stage/mapPaint';
import { mapHeightAt, mapRenderedHeightMax, subscribeMapTerrainChanges } from '../../../runtime/game/map';
import { useModifiers, currentModifiers } from '@reactjit/runtime/hooks/useModifiers';
import { getHotState, setHotState } from '@reactjit/runtime/hooks/useHotState';
import type { WorldTool } from './worldTool';
import type { PieceMaterialTarget } from './pieceEditCommand';
import { publishWorldHoverReadout } from '../data/worldHoverReadout';
import type { PieceSelectionIntent } from './selection';
import { resolvePrefabPlacement, worldPrefabById, type WorldPrefab } from './prefabs';
import type { MapPaintState } from '../stage/mapPaint';
import type { AuthoredFloraSpecies } from './floraSpecies';
import {
  builtinFloraSpeciesId,
  floraPaintSampleKey,
  pickRiggedFloraSurface,
  pickRiggedModelSurface,
  type FloraPaintSample,
  type WorldFloraBrush,
  type WorldFloraPatch,
} from './surfaceFlora';
import { FLORA_KIND_DEFINITIONS } from './floraKinds';
import MiniMap from '../stage/MiniMap';

// authored placeable id → semantic resident key: authoredResidentKeyOf (authoredRegistry).

// WASD camera pan. Distance-scaled so a keypress crosses the same fraction of the view whether
// you're surveying a district or detailing a wall (matches the drag-pan feel). Per ~16ms tick.
const WASD_KEYS = new Set(['w', 'a', 's', 'd']);
const WASD_PAN_PER_TICK = 0.02; // × eye→target distance, metres/tick

// ctrl+wheel camera tilt (req_2711), degrees per wheel notch.
const WHEEL_PITCH_STEP_DEG = 3;
// Armed-prop scroll lift (req_2751), metres per wheel notch: while a prop is
// armed the plain wheel raises/lowers the placement instead of zooming, so a
// picture goes UP THE WALL at place time — never authored floating in the studio.
const PROP_LIFT_STEP_M = 0.25;
const HOVER_READOUT_POLL_MS = 50;
// Move previews are interactive but never belong on the frame path. A snapped
// target is recomputed at most 30Hz while dragging; mouse-up always resolves the
// exact final target before committing it.
const MOVE_PREVIEW_INTERVAL_MS = 33;

// The iso camera pose's hot twig (req_2898 — framework/state/hotstate.zig): survives
// dev hot reloads (in-process), resets on a cold launch. Written on every camera push.
const ISO_POSE_TWIG_KEY = 'editor:isopose:v1';

const g: any = globalThis;

type Snap = { x: number; y: number; z: number; pieceId: string; yaw: number; floor: number; pieces?: PlacedPiece[] };

function samePieceTransform(a: PlacedPiece | null, b: PlacedPiece | null): boolean {
  return a === b || (!!a && !!b
    && a.id === b.id
    && a.x === b.x
    && a.y === b.y
    && a.z === b.z
    && a.yawDegrees === b.yawDegrees
    && a.floor === b.floor);
}

/** Project a box's 12 edges into pane-space polyline segments (the ghost),
 *  rotated by yawDeg about its centre so an edge-snapped wall's ghost lays along
 *  the edge exactly as the placed piece will (req_2569). */
function boxSegments(stage: IsoStage, rect: Rect, cx: number, baseY: number, cz: number, w: number, h: number, d: number, yawDeg = 0): number[] {
  const hw = w / 2;
  const hd = d / 2;
  const a = (yawDeg * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  // Scene3D's active +Y yaw maps local→world as
  // [x*c + z*s, -x*s + z*c]. Keep every overlay in that exact frame so an
  // asymmetric authored mesh, its picker, and its ghost agree when turned.
  const rot = (lx: number, lz: number): [number, number] => [lx * ca + lz * sa, -lx * sa + lz * ca];
  const corners: [number, number][] = ([[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]] as [number, number][]).map(([lx, lz]) => rot(lx, lz));
  const bot = corners.map(([lx, lz]) => stage.project(cx + lx, baseY, cz + lz, rect));
  const top = corners.map(([lx, lz]) => stage.project(cx + lx, baseY + h, cz + lz, rect));
  const segs: number[] = [];
  const edge = (a: { x: number; y: number } | null, b: { x: number; y: number } | null) => {
    if (a && b) segs.push(a.x, a.y, b.x, b.y);
  };
  for (let i = 0; i < 4; i += 1) {
    edge(bot[i]!, bot[(i + 1) % 4]!);
    edge(top[i]!, top[(i + 1) % 4]!);
    edge(bot[i]!, top[i]!);
  }
  return segs;
}

export default function WorldViewport(props: {
  mapOverviewOpen: boolean;
  onToggleMap: () => void;
  gameFile: string;
  storeDir: string;
  pieces: readonly PlacedPiece[];
  /** the authored (mesh) pieces to keep RESIDENT so their placements can draw. */
  authoredPieces: readonly AuthoredBuildPiece[];
  prefabs: readonly WorldPrefab[];
  worldFlora: readonly WorldFloraPatch[];
  floraSpecies: readonly AuthoredFloraSpecies[];
  armed: ArmedPiece;
  /** the modal tool that owns a click: place / select / move / focus (req_2550) */
  tool: WorldTool;
  /** every selected placed piece; the last clicked id remains primary upstream. */
  selectedIds: readonly string[];
  /** Report a click hit. Ctrl toggles one piece; Shift-click selects the full
   * touching component, while Shift-drag remains camera pan. */
  onSelect: (id: string | null, intent: PieceSelectionIntent) => void;
  /** a right-click hit a placed piece (req_2733): report it + the WINDOW coords so the
   *  quick context menu opens at the cursor. Fires in ANY tool mode — the whole point is
   *  editing the piece under the mouse without disarming the current tool. */
  onPieceContext: (id: string, x: number, y: number, role: string | null) => void;
  /** Paint Faces (req_2879): one pointer gesture's unique semantic face targets.
   *  The owner binds the active material in one authored transaction on release. */
  onPaintFaces: (targets: readonly PieceMaterialTarget[]) => void;
  /** Place Sticker (req_3025): the click's face hit as the piece-local anchor +
   *  normal a StickerPlacement stores — the owner adds the armed sticker there. */
  onStampSticker: (id: string, role: string, local: { lx: number; ly: number; lz: number; nx: number; ny: number; nz: number }) => void;
  onPaintFlora: (samples: readonly FloraPaintSample[], brush: WorldFloraBrush) => void;
  /** everything ONE gesture placed: a click is a one-piece batch, a drag-run
   *  (req_2747) is the whole wall run / floor rect — one journal entry either way. */
  onPlace: (pieces: PlacedPiece[], gesture: PlacementGesture) => void;
  /** Commit a snapped preview after one Move-tool drag. */
  onMove: (id: string, destination: PlacedPiece) => void;
  /** the active storey (0 = Ground) — owned by the action bar's floor control */
  floor: number;
  paintActive: boolean;
  mapPaint: MapPaintState;
  mapStem: string;
  mapZones: readonly MapZoneDef[];
}) {
  const loaderRef = useRef<any>(null);
  const rectRef = useRef<Rect>({ x: 0, y: 0, width: 1, height: 1 });
  const stageRef = useRef<IsoStage | null>(null);
  // The iso pose survives hot reloads through its hot twig (req_2898): every camera
  // push mirrors the pose into hotstate, and a remount seeds the stage from it — a
  // code save no longer yanks the view back to the origin. Cold start = defaults.
  if (!stageRef.current) stageRef.current = new IsoStage(
    getHotState(ISO_POSE_TWIG_KEY, { centerX: 0, centerZ: 0 }),
    mapHeightAt,
  );
  const stage = stageRef.current;
  const [snap, setSnap] = useState<Snap | null>(null);
  // The click→drag RUN (req_2747 — drag-place is back): mousedown anchors, the
  // drag extends a wall run / floor rect (resolveRunPlacements), mouseup stamps
  // it. State drives the multi-ghost overlay; the ref is what mouseup commits
  // (state written mid-gesture isn't readable in the same event's handlers).
  const [run, setRun] = useState<PlacedPiece[] | null>(null);
  const runRef = useRef<PlacedPiece[] | null>(null);
  // Move previews remain LOCAL while the pointer travels. The world model only
  // changes once on drop, keeping live-push and React off the per-frame path.
  const [movePreview, setMovePreview] = useState<PlacedPiece | null>(null);
  // Bumped on every camera move (zoom/rotate/pan) to force the overlays to RE-PROJECT. The
  // placement ghost re-renders for free via setSnap, but the selection box has no such trigger
  // when the tool isn't armed — without this it freezes at its last projection while the world
  // zooms/rotates under it (req_2555).
  const [, bumpCam] = useState(0);
  const reprojectOverlays = useCallback(() => bumpCam((v) => v + 1), []);

  const armedRef = useRef(props.armed);
  armedRef.current = props.armed;
  // The armed prop's scroll-wheel lift (req_2751): metres above the terrain/
  // storey base. Sticky across placements of the SAME prop (a gallery wall of
  // pictures hangs at one height); re-arming a different piece resets to ground.
  const propLiftRef = useRef(0);
  const armedPieceId = props.armed?.pieceId ?? null;
  const armedYawDegrees = props.armed?.yawDegrees ?? 0;
  useEffect(() => { propLiftRef.current = 0; }, [armedPieceId]);
  // Live refs so the once-created pointer callbacks read the current tool / piece list / selection
  // sink without being torn down and rebuilt every render.
  const toolRef = useRef(props.tool);
  toolRef.current = props.tool;
  const piecesRef = useRef(props.pieces);
  piecesRef.current = props.pieces;
  const authoredPiecesRef = useRef(props.authoredPieces);
  authoredPiecesRef.current = props.authoredPieces;
  const mapPaintRef = useRef(props.mapPaint);
  mapPaintRef.current = props.mapPaint;
  const prefabsRef = useRef<readonly WorldPrefab[] | undefined>(props.prefabs);
  prefabsRef.current = props.prefabs;
  const onSelectRef = useRef(props.onSelect);
  onSelectRef.current = props.onSelect;
  const onPieceContextRef = useRef(props.onPieceContext);
  onPieceContextRef.current = props.onPieceContext;
  const onPaintFacesRef = useRef(props.onPaintFaces);
  onPaintFacesRef.current = props.onPaintFaces;
  const onStampStickerRef = useRef(props.onStampSticker);
  onStampStickerRef.current = props.onStampSticker;
  const onPaintFloraRef = useRef(props.onPaintFlora);
  onPaintFloraRef.current = props.onPaintFlora;

  // The one placed-piece pick, from PANE-local coords: host raycast for catalog pieces,
  // JS slab-test for authored (model:) placements, nearest hit wins. Shared by the
  // Select-click path (onUp) and the right-click context path (req_2733).
  const pickPieceAt = useCallback((lx: number, ly: number): string | null => {
    const ray = stage.worldRay(lx, ly, rectRef.current);
    const hostHit = ray ? pickBuildPieceHostHit(ray, piecesRef.current, 1000) : null;
    const authoredHit = ray ? pickAuthoredPlacement(ray, piecesRef.current, 1000) : null;
    const host = hostHit ?? null; // undefined = host binding missing → JS pick only
    const best = host && authoredHit ? (host.t <= authoredHit.t ? host : authoredHit) : (host ?? authoredHit);
    return best ? best.piece.id : null;
  }, [stage]);

  // Paint Faces (req_2879): the FACE under the cursor as (piece, slot role). The host
  // raycast's hit normal names the face; faceRoleForHit turns it into the slot key the
  // skin renderer reads. Null = miss, an occluding authored/model piece (no slots to
  // paint), or a slotless kind — touching those is an intentional no-op, not an error.
  const pickFaceAt = useCallback((lx: number, ly: number): { id: string; role: string } | null => {
    const ray = stage.worldRay(lx, ly, rectRef.current);
    if (!ray) return null;
    const hostHit = pickBuildPieceHostHit(ray, piecesRef.current, 1000);
    const authoredBox = pickAuthoredPlacement(ray, piecesRef.current, 1000);
    const authoredRole = authoredBox
      ? pickRiggedModelSurface(ray, [authoredBox.piece], authoredPiecesRef.current, hostHit?.t ?? 1000)
      : null;
    const nearestRoleDistance = Math.min(hostHit?.t ?? Infinity, authoredRole?.t ?? Infinity);
    if (authoredBox && authoredBox.piece.id !== authoredRole?.pieceId && authoredBox.t < nearestRoleDistance) return null;
    if (authoredRole && authoredRole.t <= (hostHit?.t ?? Infinity)) return { id: authoredRole.pieceId, role: authoredRole.role };
    if (!hostHit) return null;
    const role = faceRoleForHit(hostHit.piece.pieceId, hostHit.piece.yawDegrees, hostHit.normal);
    return role ? { id: hostHit.piece.id, role } : null;
  }, [stage]);

  const pickFloraSurfaceAt = useCallback((lx: number, ly: number) => {
    const ray = stage.worldRay(lx, ly, rectRef.current);
    if (!ray) return null;
    const hostHit = pickBuildPieceHostHit(ray, piecesRef.current, 1000);
    const authoredBox = pickAuthoredPlacement(ray, piecesRef.current, 1000);
    if (!authoredBox || (hostHit && hostHit.t <= authoredBox.t)) return null;
    return pickRiggedFloraSurface(ray, [authoredBox.piece], authoredPiecesRef.current, hostHit?.t ?? 1000);
  }, [stage]);

  // One stroke's painted faces — each (piece, role) takes the brush ONCE per gesture,
  // so a sweep doesn't re-write (and re-journal) the same face on every mousemove.
  const paintFaceAt = useCallback((lx: number, ly: number, stroke: { seen: Set<string>; targets: PieceMaterialTarget[] }): void => {
    const hit = pickFaceAt(lx, ly);
    if (!hit) return;
    const key = `${hit.id}:${hit.role}`;
    if (stroke.seen.has(key)) return;
    stroke.seen.add(key);
    stroke.targets.push({ pieceId: hit.id, roles: [hit.role] });
  }, [pickFaceAt]);

  // Place Sticker (req_3025/req_3050): the click's face hit, converted to the
  // piece-local anchor + normal the placement stores. Both pick paths are stamp
  // targets — catalog pieces via the host raycast, authored (hand-exported)
  // pieces via the JS AABB pick's entry face; nearest hit wins. Authored pieces
  // have no slot roles, so their stamps record 'surface'.
  const stampStickerAt = useCallback((lx: number, ly: number): void => {
    const ray = stage.worldRay(lx, ly, rectRef.current);
    if (!ray) return;
    const hostHit = pickBuildPieceHostHit(ray, piecesRef.current, 1000);
    const authoredHit = pickAuthoredPlacement(ray, piecesRef.current, 1000);
    const authoredInFront = authoredHit && (!hostHit || authoredHit.t < hostHit.t);
    if (authoredInFront) {
      if (!authoredHit.normal) return; // ray started inside the box — no face to stamp
      const local = stickerLocalFrom(authoredHit.piece, authoredHit.point, authoredHit.normal);
      onStampStickerRef.current(authoredHit.piece.id, 'surface', local);
      return;
    }
    if (!hostHit) return;
    const role = faceRoleForHit(hostHit.piece.pieceId, hostHit.piece.yawDegrees, hostHit.normal);
    if (!role) return;
    const local = stickerLocalFrom(hostHit.piece, hostHit.point, hostHit.normal);
    onStampStickerRef.current(hostHit.piece.id, role, local);
  }, [stage]);

  // Push the JS-solved iso pose to the native loader. Cheap (8 floats) — the only
  // per-interaction bridge traffic; the host re-applies it every embedded frame.
  // Returns whether it landed (the node exists + the door is live).
  const pushCamera = useCallback((refreshTerrain = true): boolean => {
    const nodeId = Number(loaderRef.current?.id ?? 0);
    if (!nodeId || typeof g.__compiled_world_set_camera !== 'function') return false;
    if (refreshTerrain) stage.refreshTerrainElevation();
    const s: any = stage.solve();
    g.__compiled_world_set_camera(nodeId, s.pos[0], s.pos[1], s.pos[2], s.target[0], s.target[1], s.target[2], s.fov);
    setHotState(ISO_POSE_TWIG_KEY, stage.pose); // req_2898: the view survives the next hot reload
    return true;
  }, [stage]);

  const centerFromMap = useCallback((x: number, z: number): void => {
    stage.centerOn(x, z);
    pushCamera();
    reprojectOverlays();
  }, [stage, pushCamera, reprojectOverlays]);

  // Boot: aim the camera as soon as the loader node exists. The node id lands a
  // few frames after mount (host-side create), so retry until the push takes —
  // a single delayed shot missed and left the loader's own default framing
  // (the "zoomed out into nothing" boot, req_2492).
  useEffect(() => {
    if (pushCamera()) return;
    let tries = 0;
    const t = setInterval(() => {
      tries += 1;
      if (pushCamera() || tries > 120) clearInterval(t);
    }, 32);
    return () => clearInterval(t);
  }, [pushCamera]);

  // Boot ground (req_2651 gap XX): seed the map layer as soon as the host map
  // doors are live. Before this, no chunk existed until the user armed Map
  // Paint (the only mapGrowChunk call site), so a fresh editor booted into a
  // VOID — pure skybox, placed floors floating in nothing. The host paint
  // mirror renders any seeded chunk as a real ground slab, so load-or-seed at
  // mount gives boot-time ground + orientation for free. Same retry pattern as
  // the camera boot push above — the doors land a few frames after mount.
  useEffect(() => {
    const seedAndAim = (): boolean => {
      if (!ensureMapSeeded(props.mapZones, props.mapStem)) return false;
      // Camera boot runs before map activation on a cold host. Re-solve after
      // activation so a saved mountain map never keeps the sea-level boot pose.
      pushCamera();
      return true;
    };
    if (seedAndAim()) return;
    let tries = 0;
    const t = setInterval(() => {
      tries += 1;
      if (seedAndAim() || tries > 120) clearInterval(t);
    }, 32);
    return () => clearInterval(t);
  }, [props.mapStem, props.mapZones, pushCamera]);

  // Native terrain strokes, history restores, and generated-map installs do
  // not need React state just to re-aim the camera. The map door publishes one
  // completion edge; refresh once, then keep solve/project pure and cached.
  useEffect(() => subscribeMapTerrainChanges(() => {
    if (!stage.refreshTerrainElevation()) return;
    pushCamera(false);
    reprojectOverlays();
  }), [pushCamera, reprojectOverlays, stage]);

  // The active floor moves only the semantic placement/pick plane. Camera pose
  // is independent: choosing a storey must never move the user's view or cross
  // the camera host door.
  useEffect(() => {
    stage.setLevel(props.floor);
    setSnap(null);
  }, [props.floor, stage]);

  // WASD camera panning (req_2558) — it worked before the world surface moved to this viewport
  // and never got re-wired. Held keys slide the iso centre along the view's own forward/right
  // axes (stage.nudge), so W is always "into the screen" no matter the facing. A single self-
  // terminating tick loop runs only while a key is held (no idle timer). The engine routes keys
  // to focused inputs first, so this never fights text fields.
  const heldRef = useRef<Set<string>>(new Set());
  const panTimerRef = useRef<any>(null);
  const panStep = useCallback(() => {
    const h = heldRef.current;
    let forward = 0, strafe = 0;
    if (h.has('w')) forward += 1;
    if (h.has('s')) forward -= 1;
    if (h.has('d')) strafe += 1;
    if (h.has('a')) strafe -= 1;
    if (forward || strafe) {
      const step = stage.distance() * WASD_PAN_PER_TICK;
      stage.nudge(forward * step, strafe * step);
      pushCamera();
      reprojectOverlays();
    }
    panTimerRef.current = h.size ? setTimeout(panStep, 16) : null;
  }, [stage, pushCamera, reprojectOverlays]);
  const { onKeyDown: onPanKeyDown, onKeyUp: onPanKeyUp } = useModifiers();
  useEffect(() => {
    const offDown = onPanKeyDown((key) => {
      if (!WASD_KEYS.has(key)) return;
      heldRef.current.add(key);
      if (!panTimerRef.current) panTimerRef.current = setTimeout(panStep, 0);
    });
    const offUp = onPanKeyUp((key) => { heldRef.current.delete(key); });
    return () => {
      offDown(); offUp();
      if (panTimerRef.current) { clearTimeout(panTimerRef.current); panTimerRef.current = null; }
      heldRef.current.clear();
    };
    // Subscribe ONCE on mount: onPanKeyDown/onPanKeyUp just wrap the module key bus and panStep is
    // stable, so re-subscribing per render is both unnecessary and harmful — it would clear the
    // held-key set mid-pan on any unrelated re-render and stall the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nativePaintRouteRef = useRef<{ nodeId: number; enabled: boolean } | null>(null);
  const setNativePaintRoute = useCallback((enabled: boolean) => {
    const nodeId = Number(loaderRef.current?.id ?? 0);
    if (!nodeId || typeof g.__compiled_world_set_paint_mode !== 'function') return;
    const previous = nativePaintRouteRef.current;
    if (previous?.nodeId === nodeId && previous.enabled === enabled) return;
    g.__compiled_world_set_paint_mode(nodeId, enabled ? 1 : 0);
    nativePaintRouteRef.current = { nodeId, enabled };
  }, []);

  // Native terrain painting remains zero-JS. Custom flora and a rigged flora
  // face temporarily route to the recipe painter below; hover restores native
  // ownership as soon as the cursor is back over ordinary ground.
  useEffect(() => {
    const customFlora = props.mapPaint.channel === 'flora' && !!props.mapPaint.floraSpeciesId;
    setNativePaintRoute(props.paintActive && !customFlora);
    return () => setNativePaintRoute(false);
  }, [props.paintActive, props.mapPaint.channel, props.mapPaint.floraSpeciesId, setNativePaintRoute]);

  // Live overlay: placed pieces render as real meshes instantly, no rebake.
  // (Shared seam with the playtest tab — world/livePush.ts.)
  useEffect(() => {
    const push = () => pushLiveWorld(Number(loaderRef.current?.id ?? 0), props.pieces, props.authoredPieces, props.worldFlora, props.floraSpecies);
    if (push()) return;
    let tries = 0;
    const t = setInterval(() => { tries += 1; if (push() || tries > 120) clearInterval(t); }, 32);
    return () => clearInterval(t);
  }, [props.pieces, props.authoredPieces, props.worldFlora, props.floraSpecies]);

  // Keep the authored meshes RESIDENT so their placements can draw (req_2577).
  // Rebuilds + pushes the MESH_PROPS catalog whenever the authored list changes;
  // retries until the loader node exists (it lands a few frames after mount).
  useEffect(() => {
    const push = () => pushResidentMeshes(Number(loaderRef.current?.id ?? 0), props.authoredPieces, props.floraSpecies);
    if (push()) return;
    let tries = 0;
    const t = setInterval(() => { tries += 1; if (push() || tries > 120) clearInterval(t); }, 32);
    return () => clearInterval(t);
  }, [props.authoredPieces, props.floraSpecies]);

  // Mesh GHOST: an authored piece previews as its real translucent mesh while
  // it is armed OR being moved. Catalog pieces keep the projected box ghost.
  useEffect(() => {
    const nodeId = Number(loaderRef.current?.id ?? 0);
    if (!nodeId) return;
    const armed = props.armed;
    const placementGhost = armed && isAuthoredPiece(armed.pieceId) && props.tool === 'place' && snap
      ? { pieceId: armed.pieceId, x: snap.x, y: snap.y, z: snap.z, yawDegrees: snap.yaw }
      : null;
    const ghost = placementGhost ?? (props.tool === 'move' && movePreview && isAuthoredPiece(movePreview.pieceId) ? movePreview : null);
    if (ghost && typeof g.__compiled_world_set_live_mesh_ghost === 'function') {
      g.__compiled_world_set_live_mesh_ghost(nodeId, encodeMeshGhost({ key: authoredResidentKeyOf(ghost.pieceId), x: ghost.x, y: ghost.y, z: ghost.z, yaw: ghost.yawDegrees }));
    } else if (typeof g.__compiled_world_clear_live_mesh_ghost === 'function') {
      g.__compiled_world_clear_live_mesh_ghost(nodeId);
    }
  }, [snap, movePreview, props.armed, props.tool]);

  // Unmount: drop the loader runtime + its pending camera.
  useEffect(() => () => {
    const nodeId = Number(loaderRef.current?.id ?? 0);
    if (!nodeId) return;
    if (typeof g.__compiled_world_clear_camera === 'function') g.__compiled_world_clear_camera(nodeId);
    if (typeof g.__compiled_world_unmount === 'function') g.__compiled_world_unmount(nodeId);
  }, []);

  // The ground under a pane-local cursor, TERRAIN-AWARE (req_2666): ask the host
  // door first — __compiled_world_ground_hit raycasts the painted heightfield on
  // the brush beam's exact code path (paintGroundHitAt), so a placement lands ON
  // the sculpted mesa the brush just raised instead of burying at the flat y=0
  // plane. The door takes WINDOW coords (getMouseX's space); pane-local px/py
  // convert via the live rect. Falls back to the analytic flat plane
  // (stage.groundPoint, terrainY 0) when the door is absent or the ray misses
  // every painted chunk (off-map) — flat placement behaves exactly as before.
  const groundUnder = useCallback((px: number, py: number): { x: number; z: number; terrainY: number } | null => {
    const r = rectRef.current;
    const nodeId = Number(loaderRef.current?.id ?? 0);
    // The active storey lifts the picked surface (req_2744): without levelY the
    // door intersected the GROUND even on Floor 2+, so the piece (based at
    // terrainY + floor×3m) projected away from the cursor — perfect at Ground,
    // one storey's worth of drift per floor up. The door keeps returning the
    // true terrain height; resolvePlacement adds the storey back.
    const levelY = props.floor > 0 ? props.floor * METERS_PER_LEVEL : 0;
    if (nodeId && typeof g.__compiled_world_ground_hit === 'function') {
      const buf = g.__compiled_world_ground_hit(nodeId, r.x + px, r.y + py, levelY);
      if (buf) {
        const hit = new Float32Array(buf);
        if (hit.length >= 3) return { x: hit[0]!, z: hit[2]!, terrainY: hit[1]! };
      }
    }
    const gp = stage.groundPoint(px, py, r);
    return gp ? { x: gp.x, z: gp.z, terrainY: 0 } : null;
  }, [stage, props.floor]);

  // Prop stacking (req_3363): the placement ray may strike a placed piece's TOP
  // FACE before the terrain — a table top is a placement surface, exactly the
  // hmsc-int rule ("nearest of (placed-piece face, ground) wins; piece faces
  // stack from actual top faces", editors/build/snap.ts). Both pick paths run —
  // host raycast for catalog pieces, JS slab test for authored (model:) meshes —
  // and the nearest top-face hit that beats the ground along the ray becomes the
  // prop's base. Side faces never stack; the ground resolve keeps them.
  const supportUnder = useCallback((
    px: number,
    py: number,
    gp: { x: number; z: number; terrainY: number },
  ): { x: number; y: number; z: number } | null => {
    const ray = stage.worldRay(px, py, rectRef.current);
    if (!ray) return null;
    const hostHit = pickBuildPieceHostHit(ray, piecesRef.current, 1000) ?? null;
    const authoredHit = pickAuthoredPlacement(ray, piecesRef.current, 1000);
    const best = hostHit && authoredHit ? (hostHit.t <= authoredHit.t ? hostHit : authoredHit) : (hostHit ?? authoredHit);
    if (!best || !best.normal || best.normal.y <= 0.5) return null;
    // The ground door intersects the storey-lifted surface (req_2744); rebuild
    // that point and compare distances along the SAME ray so "the table is in
    // front of the floor" means what the eye sees. t normalizes by |dir|² since
    // the piece picks report t in ray-direction units.
    const levelY = props.floor > 0 ? props.floor * METERS_PER_LEVEL : 0;
    const dx = gp.x - ray.origin.x;
    const dy = gp.terrainY + levelY - ray.origin.y;
    const dz = gp.z - ray.origin.z;
    const dirSq = ray.dir.x * ray.dir.x + ray.dir.y * ray.dir.y + ray.dir.z * ray.dir.z;
    const groundT = dirSq > 0 ? (dx * ray.dir.x + dy * ray.dir.y + dz * ray.dir.z) / dirSq : Infinity;
    if (best.t >= groundT) return null;
    return { x: best.point.x, y: best.point.y, z: best.point.z };
  }, [stage, props.floor]);

  const resolveSnap = useCallback((px: number, py: number): Snap | null => {
    const armed = armedRef.current;
    if (!armed) return null;
    const gp = groundUnder(px, py);
    if (!gp) return null;
    const prefab = worldPrefabById(prefabsRef.current, armed.pieceId);
    if (prefab) {
      const pieces = resolvePrefabPlacement(prefab, gp, props.floor, armed.yawDegrees, mapRenderedHeightMax);
      if (pieces.length === 0) return null;
      const anchor = pieces[0]!;
      return { x: anchor.x, y: anchor.y, z: anchor.z, pieceId: prefab.id, yaw: armed.yawDegrees, floor: props.floor, pieces };
    }
    // The floor INDEX threads through whole (req_2676): resolvePlacement records
    // it on the piece so the storey cutaway never re-derives storey from a y that
    // now carries the terrain base too (a mesa-top Ground piece is storey 0).
    // An armed PROP first probes for a placed piece under the cursor (req_3363):
    // a top-face hit nearer than the ground becomes the base, so a lamp lands ON
    // the table exactly where the ray touched it.
    const support = pieceKindOf(armed.pieceId) === 'prop' ? supportUnder(px, py, gp) : null;
    const placed = resolvePlacement(
      armed.pieceId,
      support?.x ?? gp.x,
      support?.z ?? gp.z,
      props.floor,
      gp.terrainY,
      propLiftRef.current,
      armed.yawDegrees,
      mapRenderedHeightMax,
      support?.y ?? null,
    );
    return placed ? { x: placed.x, y: placed.y, z: placed.z, pieceId: placed.pieceId, yaw: placed.yawDegrees, floor: placed.floor ?? props.floor } : null;
  }, [groundUnder, supportUnder, props.floor]);

  // R changes the armed turn in AppFrame. Re-resolve immediately at the live
  // cursor so the user sees the ghost spin in place, rather than waiting for the
  // next 50ms hover poll or mouse movement.
  useEffect(() => {
    if (props.tool !== 'place' || !armedPieceId) return;
    const r = rectRef.current;
    const mx = Number(g.getMouseX?.() ?? NaN);
    const my = Number(g.getMouseY?.() ?? NaN);
    if (Number.isFinite(mx) && Number.isFinite(my) && mx >= r.x && mx < r.x + r.width && my >= r.y && my < r.y + r.height) {
      setSnap(resolveSnap(mx - r.x, my - r.y));
    }
  }, [armedPieceId, armedYawDegrees, props.tool, resolveSnap]);

  // Leaving Move mode (including Esc) abandons an in-flight local preview. The
  // source instance remains authoritative until onMouseUp commits a destination.
  useEffect(() => {
    if (props.tool !== 'move') setMovePreview(null);
  }, [props.tool]);

  const publishHoverAt = useCallback((px: number, py: number): Snap | null => {
    const snap = props.tool === 'place' && armedRef.current ? resolveSnap(px, py) : null;
    if (snap) {
      publishWorldHoverReadout({ x: snap.x, y: snap.y, z: snap.z });
      return snap;
    }
    const gp = groundUnder(px, py);
    if (!gp) {
      publishWorldHoverReadout(null);
      return null;
    }
    const levelY = props.floor > 0 ? props.floor * METERS_PER_LEVEL : 0;
    publishWorldHoverReadout({ x: gp.x, y: gp.terrainY + levelY, z: gp.z });
    return null;
  }, [groundUnder, props.floor, props.tool, resolveSnap]);

  // Free-hover tracking (req_2651 gap VV + req_2736 POS readout): the framework delivers
  // onMouseMove ONLY under pointer capture (capture starts at mousedown —
  // nodeWantsPointerCapture, framework/engine.zig), so with no button held the
  // armed ghost froze at its last projection until the camera moved. The host's
  // paint brush beam is immune because it polls SDL mouse state. Same pattern
  // here: a low-rate poll reads the global mouse so the bottom dock can show the
  // terrain-aware map point even while map paint owns pointer events. The place
  // ghost still re-snaps only when armed; the dock store dedupes rounded coords.
  const hoverTimerRef = useRef<any>(null);
  const armedHover = props.tool === 'place' && !!props.armed;
  useEffect(() => {
    const sameSnap = (a: Snap | null, b: Snap | null): boolean =>
      a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z && a.yaw === b.yaw && a.pieceId === b.pieceId);
    const step = () => {
      const r = rectRef.current;
      const mx = Number(g.getMouseX?.() ?? NaN);
      const my = Number(g.getMouseY?.() ?? NaN);
      // A live drag owns the ghost (req_2747): onMove drives the run overlay and
      // nulls snap; the poll re-snapping here would resurrect the single ghost
      // under it every 50ms. The POS readout keeps publishing either way.
      const dragging = !!dragRef.current?.turned;
      if (Number.isFinite(mx) && Number.isFinite(my)) {
        const inside = mx >= r.x && mx < r.x + r.width && my >= r.y && my < r.y + r.height;
        const paint = mapPaintRef.current;
        if (paint.active && paint.channel === 'flora') {
          const customOwns = !!paint.floraSpeciesId;
          const surfaceOwns = inside && !!pickFloraSurfaceAt(mx - r.x, my - r.y);
          // Once a rigged-surface stroke starts, JS owns the whole captured
          // gesture. Crossing onto ordinary ground mid-drag must not re-arm the
          // native painter underneath it before mouse-up.
          const surfaceStrokeOwns = !!dragRef.current?.flora;
          setNativePaintRoute(!customOwns && !surfaceOwns && !surfaceStrokeOwns);
        } else {
          setNativePaintRoute(paint.active);
        }
        const next = inside ? publishHoverAt(mx - r.x, my - r.y) : null;
        if (!inside) publishWorldHoverReadout(null);
        if ((armedHover || !inside) && !dragging) setSnap((cur) => (sameSnap(cur, next) ? cur : next));
      } else {
        const paint = mapPaintRef.current;
        setNativePaintRoute(paint.active && !(paint.channel === 'flora' && !!paint.floraSpeciesId));
        publishWorldHoverReadout(null);
        if (armedHover && !dragging) setSnap(null);
      }
      hoverTimerRef.current = setTimeout(step, HOVER_READOUT_POLL_MS);
    };
    hoverTimerRef.current = setTimeout(step, 0);
    return () => {
      if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
      setSnap(null);
      publishWorldHoverReadout(null);
    };
    // armedHover collapses props.armed (a fresh object every parent render) to a boolean, so the
    // loop tears down only on real disarm/tool change — not on every unrelated re-render.
  }, [armedHover, publishHoverAt, pickFloraSurfaceAt, setNativePaintRoute]);

  // ── input: middle-drag orbits — x-travel spins the yaw, y-travel tilts the
  // pitch (req_2710) — shift-drag grabs the map, wheel zooms to the cursor
  // (ctrl+wheel tilts instead), a click (no travel) places the armed piece.
  // Paint clicks never reach here — the host claims LEFT while the paint tool
  // is armed, which is exactly why the orbit lives on MIDDLE: you can orbit
  // mid-painting without disarming the brush.
  //
  // The engine dispatches middle only as a one-shot onMiddleClick (the JS
  // capture pipeline is LEFT-only), so the drag is a self-terminating ~16ms
  // poll (the panStep shape): orbit by the cursor's travel until the host's
  // getMouseButtons() mask says the middle button lifted.
  const MMB_MASK = 2; // SDL button mask bit for the middle button
  const ORBIT_YAW_PER_PX = 0.3;
  const ORBIT_PITCH_PER_PX = 0.25; // drag down = lower toward the horizon
  const orbitTimerRef = useRef<any>(null);
  const orbitLastRef = useRef({ x: 0, y: 0 });
  const orbitStep = useCallback(() => {
    const held = (Number(g.getMouseButtons?.() ?? 0) & MMB_MASK) !== 0;
    if (!held) { orbitTimerRef.current = null; return; }
    const last = orbitLastRef.current;
    const x = Number(g.getMouseX?.() ?? last.x);
    const y = Number(g.getMouseY?.() ?? last.y);
    const dx = x - last.x;
    const dy = y - last.y;
    if (dx || dy) {
      orbitLastRef.current = { x, y };
      if (dx) stage.rotateBy(dx * ORBIT_YAW_PER_PX);
      if (dy) stage.pitchBy(-dy * ORBIT_PITCH_PER_PX);
      pushCamera();
      reprojectOverlays();
    }
    orbitTimerRef.current = setTimeout(orbitStep, 16);
  }, [stage, pushCamera, reprojectOverlays]);
  const onMiddleDown = useCallback(() => {
    orbitLastRef.current = { x: Number(g.getMouseX?.() ?? 0), y: Number(g.getMouseY?.() ?? 0) };
    if (!orbitTimerRef.current) orbitTimerRef.current = setTimeout(orbitStep, 16);
  }, [orbitStep]);
  useEffect(() => () => {
    if (orbitTimerRef.current) { clearTimeout(orbitTimerRef.current); orbitTimerRef.current = null; }
  }, []);
  type MoveDrag = {
    piece: PlacedPiece;
    anchorX: number;
    anchorZ: number;
    target: PlacedPiece | null;
    previewAtMs: number;
  };
  const dragRef = useRef<{
    x: number;
    x0: number;
    y0: number;
    turned: boolean;
    pan: boolean;
    selectionIntent: PieceSelectionIntent;
    runAnchor: { x: number; z: number; terrainY: number } | null;
    runCell: { x: number; z: number } | null;
    move: MoveDrag | null;
    /** Paint Faces stroke (req_2879): unique (piece:role) targets gathered during
     *  this gesture. Non-null means release must commit or discard the batch. */
    paint: { seen: Set<string>; targets: PieceMaterialTarget[] } | null;
    flora: { seen: Set<string>; samples: FloraPaintSample[] } | null;
  } | null>(null);
  const local = useCallback((e: any) => {
    const r = rectRef.current;
    return { x: Number(e?.x ?? 0) - r.x, y: Number(e?.y ?? 0) - r.y };
  }, []);

  const floraSampleAt = useCallback((lx: number, ly: number): FloraPaintSample | null => {
    const paint = mapPaintRef.current;
    if (!paint.active || paint.channel !== 'flora') return null;
    const surface = pickFloraSurfaceAt(lx, ly);
    if (surface) {
      const { t: _t, nx: _nx, ny: _ny, nz: _nz, ...sample } = surface;
      return sample;
    }
    // Native species keep their zero-JS terrain path. A custom package has no
    // native recipe, so its fallback target is the ordinary terrain hit.
    if (!paint.floraSpeciesId) return null;
    const ground = groundUnder(lx, ly);
    return ground ? { kind: 'ground', x: ground.x, y: ground.terrainY, z: ground.z } : null;
  }, [groundUnder, pickFloraSurfaceAt]);

  const onDown = useCallback((e: any) => {
    const p = local(e);
    const liveModifiers = currentModifiers();
    const shift = !!e?.shiftKey || liveModifiers.shift;
    const toggle = !!e?.ctrlKey || !!e?.metaKey || liveModifiers.ctrl || liveModifiers.meta;
    if (!shift && props.paintActive && mapPaintRef.current.channel === 'flora') {
      const sample = floraSampleAt(p.x, p.y);
      if (sample) {
        dragRef.current = {
          x: p.x, x0: p.x, y0: p.y, turned: false, pan: false,
          selectionIntent: 'replace', runAnchor: null, runCell: null, move: null, paint: null,
          flora: { seen: new Set([floraPaintSampleKey(sample)]), samples: [sample] },
        };
        return;
      }
      // A custom brush owns both surfaces and ground. A miss is inert; never
      // let the Select tool underneath mutate selection while Map Paint is on.
      if (mapPaintRef.current.floraSpeciesId) return;
    }
    if (props.paintActive) return;
    // Drag-run anchor (req_2747): a left-down on the Place tool with a grid
    // piece armed remembers the ground point under it — if the gesture turns
    // into a drag, that point anchors the wall run / floor rect. Exported build
    // pieces inherit this from their semantic affinity; props stay single, and
    // shift keeps meaning pan.
    const armed = armedRef.current;
    const runnable = !shift && toolRef.current === 'place' && !!armed
      && supportsRunPlacement(armed.pieceId);
    const anchor = runnable ? groundUnder(p.x, p.y) : null;
    // Move captures a placed instance plus the ground point under the cursor.
    // Subsequent pointer travel becomes a world-space delta, so grabbing a wall
    // by one end does not make its centre jump underneath the pointer.
    const movingId = !shift && toolRef.current === 'move' ? pickPieceAt(p.x, p.y) : null;
    const movingPiece = movingId ? piecesRef.current.find((piece) => piece.id === movingId) ?? null : null;
    const moveGround = movingPiece ? groundUnder(p.x, p.y) : null;
    if (movingPiece) onSelectRef.current(movingPiece.id, 'replace');
    // Paint Faces (req_2879): down gathers the first touch; later samples add new
    // faces without mutating authored state until the whole gesture is committed.
    const paint = !shift && toolRef.current === 'paintFace'
      ? { seen: new Set<string>(), targets: [] as PieceMaterialTarget[] }
      : null;
    // Place Sticker (req_3025): a click stamps once — no drag semantics.
    if (!shift && toolRef.current === 'sticker') stampStickerAt(p.x, p.y);
    setMovePreview(null);
    dragRef.current = {
      x: p.x,
      x0: p.x,
      y0: p.y,
      turned: false,
      pan: shift,
      selectionIntent: toggle ? 'toggle' : shift ? 'connected' : 'replace',
      runAnchor: anchor,
      runCell: null,
      move: movingPiece && moveGround
        ? { piece: movingPiece, anchorX: moveGround.x, anchorZ: moveGround.z, target: null, previewAtMs: 0 }
        : null,
      paint,
      flora: null,
    };
    if (paint) paintFaceAt(p.x, p.y, paint);
  }, [local, groundUnder, pickPieceAt, paintFaceAt, stampStickerAt, floraSampleAt, props.paintActive]);

  const onMove = useCallback((e: any) => {
    const p = local(e);
    const d = dragRef.current;
    if (d && Math.abs(p.x - d.x0) + Math.abs(p.y - d.y0) > 4) {
      d.turned = true;
      // Rotation moved to middle-drag (req_2704); shift-drag pans; a plain left
      // drag either moves its picked instance or extends a placement RUN.
      if (d.pan) {
        stage.dragPan(d.x, d.y0, p.x, p.y, rectRef.current);
        d.y0 = p.y;
        d.x = p.x;
        pushCamera();
        // Armed → setSnap re-renders (ghost follows). Not armed → force a re-project so the
        // selection box stays glued to its piece as the camera rotates/pans (req_2555).
        if (armedRef.current) setSnap(resolveSnap(p.x, p.y));
        else reprojectOverlays();
        return;
      }
      d.x = p.x;
      if (d.flora) {
        const sample = floraSampleAt(p.x, p.y);
        if (sample) {
          const key = floraPaintSampleKey(sample);
          if (!d.flora.seen.has(key)) {
            d.flora.seen.add(key);
            d.flora.samples.push(sample);
          }
        }
        return;
      }
      // A paint stroke sweeps: every face the pointer crosses takes the brush once
      // (the stroke set dedupes). Nothing else in the drag machinery applies.
      if (d.paint) {
        paintFaceAt(p.x, p.y, d.paint);
        return;
      }
      if (d.move) {
        const now = Date.now();
        if (now - d.move.previewAtMs < MOVE_PREVIEW_INTERVAL_MS) return;
        d.move.previewAtMs = now;
        const gp = groundUnder(p.x, p.y);
        if (gp) {
          const target = resolveMovedPlacement(
            d.move.piece,
            d.move.piece.x + (gp.x - d.move.anchorX),
            d.move.piece.z + (gp.z - d.move.anchorZ),
            gp.terrainY,
            mapRenderedHeightMax,
          );
          if (!samePieceTransform(d.move.target, target)) {
            d.move.target = target;
            setMovePreview(target);
          }
        }
        return;
      }
      const armed = armedRef.current;
      if (d.runAnchor && armed) {
        const gp = groundUnder(p.x, p.y);
        if (gp) {
          // Re-resolve only when the cursor crosses into a new CELL — a full run
          // re-validates every piece against the host, and per-pixel mousemoves
          // would hammer that door for an unchanged result.
          const cellX = Math.floor(gp.x / PIECE_MODULE_METERS);
          const cellZ = Math.floor(gp.z / PIECE_MODULE_METERS);
          if (runRef.current && d.runCell && d.runCell.x === cellX && d.runCell.z === cellZ) return;
          d.runCell = { x: cellX, z: cellZ };
          // One native rectangle query chooses the highest RENDERED terrain
          // point under the complete run. The run stays one level foundation
          // plane without letting an uphill patch swallow its 5 cm floor slabs.
          const pieces = resolveRunPlacements(
            armed.pieceId,
            d.runAnchor.x,
            d.runAnchor.z,
            gp.x,
            gp.z,
            props.floor,
            d.runAnchor.terrainY,
            armed.yawDegrees,
            mapRenderedHeightMax,
          );
          runRef.current = pieces;
          setRun(pieces);
          setSnap(null); // the run ghosts own the overlay while dragging
          return;
        }
      }
    }
    if (armedRef.current) setSnap(resolveSnap(p.x, p.y));
  }, [local, stage, pushCamera, resolveSnap, reprojectOverlays, groundUnder, props.floor, paintFaceAt, floraSampleAt]);

  const onUp = useCallback((e: any) => {
    const d = dragRef.current;
    dragRef.current = null;
    const runPieces = runRef.current;
    runRef.current = null;
    setRun(null);
    const movePointer = d?.move ? local(e) : null;
    const moveGround = d?.move && movePointer ? groundUnder(movePointer.x, movePointer.y) : null;
    // Commit the exact release point even when the bounded preview has not yet
    // sampled this last mouse event.
    const moveTarget = d?.move && moveGround
      ? resolveMovedPlacement(
        d.move.piece,
        d.move.piece.x + (moveGround.x - d.move.anchorX),
        d.move.piece.z + (moveGround.z - d.move.anchorZ),
        moveGround.terrainY,
        mapRenderedHeightMax,
      )
      : null;
    setMovePreview(null);
    if (!d) { console.warn('[place] up with no down — click dropped'); return; }
    if (d.flora) {
      const paint = mapPaintRef.current;
      const definition = FLORA_KIND_DEFINITIONS[paint.floraKindIdx];
      const speciesId = paint.floraSpeciesId ?? (definition ? builtinFloraSpeciesId(definition.kind) : null);
      if (speciesId && d.flora.samples.length) {
        onPaintFloraRef.current(d.flora.samples, {
          speciesId,
          mode: paint.mode,
          density: paint.floraDensity,
          radiusM: Math.max(0.1, paint.radiusM),
        });
      }
      return;
    }
    // One pointer gesture is one authored action: down/move only gather unique
    // semantic faces; up submits the whole batch through command authority.
    if (d.paint) {
      if (d.paint.targets.length > 0) onPaintFacesRef.current(d.paint.targets);
      return;
    }
    // req_2548 diagnostic — every way a click can silently place nothing.
    if (d.turned) {
      // Move commits precisely once on drop; its local preview never mutated the
      // authoring state while the pointer was travelling.
      if (d.move && moveTarget && toolRef.current === 'move') {
        props.onMove(d.move.piece.id, moveTarget);
        return;
      }
      // A drag that grew a run stamps the whole run (req_2747); any other drag
      // is still inert.
      if (runPieces && runPieces.length && toolRef.current === 'place') {
        console.warn(`[place] drag-run -> place ${runPieces.length}× ${runPieces[0]!.pieceId}`);
        const p = local(e);
        props.onPlace(runPieces, { mode: 'drag-run', inputAtMs: Date.now(), pointerX: p.x, pointerY: p.y });
        return;
      }
      const p = local(e);
      console.warn(`[place] click ate as DRAG (travel ${Math.abs(p.x - d.x0).toFixed(0)}+${Math.abs(p.y - d.y0).toFixed(0)}px from down)`);
      return;
    }
    // Modal click routing (req_2550): OFF the Place tool a click PICKS the piece under it via the
    // host raycast and highlights it — Select/Move/Focus never place. Move turns
    // into a real transform only after travel from a picked instance (above).
    // This is what makes turning on Focus (etc.) stop dropping pieces. (Focus does NOT pan the
    // camera on the pick: that shifted the JS pose the overlay projects through while the native
    // frame lagged, so the outline landed a tile off, req_2554. Camera-frame is a deferred slice
    // done through a re-render-safe path.)
    const tool = toolRef.current;
    if (tool !== 'place') {
      onSelectRef.current(pickPieceAt(d.x0, d.y0), d.selectionIntent);
      return;
    }
    if (!armedRef.current) { console.warn('[place] click with nothing armed'); return; }
    // Terrain-aware ground check (req_2666): the same door-first resolve the snap
    // path uses, so the click and its ghost agree about where the ground is.
    const gp = groundUnder(d.x0, d.y0);
    if (!gp) { console.warn(`[place] GROUND MISS at (${d.x0.toFixed(0)},${d.y0.toFixed(0)}) rect=(${rectRef.current.x},${rectRef.current.y} ${rectRef.current.width}x${rectRef.current.height})`); return; }
    const target = resolveSnap(d.x0, d.y0);
    if (!target) { console.warn(`[place] VALIDATOR rejected cell at world (${gp.x.toFixed(1)},${gp.z.toFixed(1)})`); return; }
    if (target.pieces?.length) {
      console.warn(`[place] click -> prefab ${target.pieceId} (${target.pieces.length} semantic pieces)`);
      props.onPlace(target.pieces, { mode: 'click', inputAtMs: Date.now(), pointerX: d.x0, pointerY: d.y0 });
      return;
    }
    console.warn(`[place] click -> place ${target.pieceId} at (${target.x},${target.y},${target.z}) yaw ${target.yaw}`);
    props.onPlace(
      [{ id: '', pieceId: target.pieceId, x: target.x, y: target.y, z: target.z, yawDegrees: target.yaw, floor: target.floor }],
      { mode: 'click', inputAtMs: Date.now(), pointerX: d.x0, pointerY: d.y0 },
    );
  }, [resolveSnap, groundUnder, props.onPlace, props.onMove, local, stage, pickPieceAt]);

  // Right-click quick context (req_2733): pick the piece under the cursor in ANY tool
  // mode and report it up with the WINDOW coords (the root-mounted menu lands at the
  // cursor). A miss is a no-op — empty ground has no quick verbs, and eating the
  // click keeps a stray right-click from dropping the current selection.
  const onRightClick = useCallback((e: any) => {
    const p = local(e);
    const hit = pickFaceAt(p.x, p.y);
    if (hit) onPieceContextRef.current(hit.id, Number(e?.x ?? 0), Number(e?.y ?? 0), hit.role);
    else {
      const id = pickPieceAt(p.x, p.y);
      if (id) onPieceContextRef.current(id, Number(e?.x ?? 0), Number(e?.y ?? 0), null);
    }
  }, [local, pickFaceAt, pickPieceAt]);

  const onScroll = useCallback((e: any) => {
    const dy = Number(e?.deltaY ?? 0);
    if (!dy) return;
    const r = rectRef.current;
    const mx = Number(g.getMouseX?.() ?? (r.x + r.width / 2));
    const my = Number(g.getMouseY?.() ?? (r.y + r.height / 2));
    // Armed prop → the wheel is the HEIGHT dial (req_2751): scroll up lifts the
    // placement off its base (posters climb the wall), scroll down brings it
    // back down (clamped — the base is the floor of the gesture). The base is
    // the terrain/storey plane, or a placed piece's top face when the cursor is
    // over one (req_3363) — a table top needs NO lift; the dial rides above it.
    // Props only: build pieces are grid pieces, their verticality is storeys.
    // Ctrl+wheel keeps the camera tilt either way; zoom while placing a prop
    // means disarming first, which is the deliberate trade.
    const armed = armedRef.current;
    if (!currentModifiers().ctrl && toolRef.current === 'place' && armed && pieceKindOf(armed.pieceId) === 'prop') {
      propLiftRef.current = Math.max(0, propLiftRef.current + (dy > 0 ? PROP_LIFT_STEP_M : -PROP_LIFT_STEP_M));
      setSnap(resolveSnap(mx - r.x, my - r.y));
      return;
    }
    if (currentModifiers().ctrl) {
      // ctrl+wheel tilts (req_2711): wheel up climbs toward a plan view,
      // wheel down levels toward the horizon. Zoom stays untouched.
      stage.pitchBy(dy > 0 ? -WHEEL_PITCH_STEP_DEG : WHEEL_PITCH_STEP_DEG);
    } else {
      stage.zoomToCursor(mx - r.x, my - r.y, dy > 0 ? 1.15 : 1 / 1.15, r);
    }
    pushCamera();
    // The ghost outline is a render-time projection through this stage. Rotate
    // and pan refresh it via onMove's setSnap, but a wheel zoom moves the camera
    // with no render — the loader repaints with the new solve while the overlay
    // keeps the old one (req_2541). Re-snap at the cursor so it reprojects. A
    // live drag-run owns snap (req_2747) — just force the re-project instead.
    if (armedRef.current && !dragRef.current?.turned) setSnap(resolveSnap(mx - r.x, my - r.y));
    else reprojectOverlays(); // keep the selection box / run ghosts glued through a wheel zoom (req_2555)
  }, [stage, pushCamera, resolveSnap, reprojectOverlays]);

  // The armed ghost: the piece's box edges projected through the same solve the
  // loader renders with (2D overlay, no second 3D surface).
  const rect = rectRef.current;
  const ghostSegs: number[] = [];
  // Only Place shows its armed ghost; Move supplies its own local candidate below.
  if (snap && props.tool === 'place') {
    if (snap.pieces) {
      for (const piece of snap.pieces) {
        const look = pieceLook(piece.pieceId);
        if (look) ghostSegs.push(...boxSegments(stage, rect, piece.x, piece.y, piece.z, look.w, look.h, look.d, piece.yawDegrees));
      }
    } else {
      const look = pieceLook(snap.pieceId);
      if (look) ghostSegs.push(...boxSegments(stage, rect, snap.x, snap.y, snap.z, look.w, look.h, look.d, snap.yaw));
    }
  }
  // Mid-drag, every piece the run would stamp ghosts at once (req_2747) — snap
  // is nulled while a run is live, so the two never double-draw.
  if (run && run.length && props.tool === 'place') {
    const look = pieceLook(run[0]!.pieceId);
    if (look) for (const rp of run) ghostSegs.push(...boxSegments(stage, rect, rp.x, rp.y, rp.z, look.w, look.h, look.d, rp.yawDegrees));
  }
  // A Move-tool drag previews the committed transform without pushing the world
  // list each frame. The selected source remains cyan below; this green outline
  // is the destination that will land on mouse-up.
  if (movePreview && props.tool === 'move') {
    const look = pieceLook(movePreview.pieceId);
    if (look) ghostSegs.push(...boxSegments(stage, rect, movePreview.x, movePreview.y, movePreview.z, look.w, look.h, look.d, movePreview.yawDegrees));
  }
  // The selection highlight: the same projected box around the selected piece (req_2550), so a
  // Select/Move/Focus click shows what it grabbed. Same overlay technique as the ghost. NOT shown
  // in Place mode — there the green placement ghost owns the overlay, and a lingering cyan
  // selection from an earlier pick just reads as a confusing second outline (req_2554).
  const selectedSegs: number[] = [];
  if (props.tool !== 'place') for (const selectedId of props.selectedIds) {
    const sel = props.pieces.find((p) => p.id === selectedId);
    const look = sel ? pieceLook(sel.pieceId) : null;
    if (sel && look) selectedSegs.push(...boxSegments(stage, rect, sel.x, sel.y, sel.z, look.w, look.h, look.d, sel.yawDegrees));
  }

  return (
    <Box
      style={{ width: '100%', height: '100%', position: 'relative', backgroundColor: '#0d141f' }}
      onLayout={(lr: any) => { rectRef.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height }; }}
    >
      {createElement('WorldLoader', {
        ref: loaderRef,
        gameFile: props.gameFile,
        storeDir: props.storeDir,
        testID: 'editor-world-viewport',
        style: { width: '100%', height: '100%' },
      })}

      {/* 2D projected ghost — identity view, never eats input */}
      {ghostSegs.length ? (
        <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, pointerEvents: 'none', overflow: 'visible' }}>
          <Graph style={{ width: rect.width, height: rect.height }} viewX={0} viewY={0} viewZoom={1} originTopLeft>
            <Graph.Polyline segments points={ghostSegs} stroke="#34d399" strokeWidth={1.6} />
          </Graph>
        </Box>
      ) : null}

      {/* Selection highlight — the box around the picked piece (Select/Move/Focus). */}
      {selectedSegs.length ? (
        <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, pointerEvents: 'none', overflow: 'visible' }}>
          <Graph style={{ width: rect.width, height: rect.height }} viewX={0} viewY={0} viewZoom={1} originTopLeft>
            <Graph.Polyline segments points={selectedSegs} stroke="#42d9e8" strokeWidth={2.2} />
          </Graph>
        </Box>
      ) : null}

      {/* pointer capture (near-transparent so it's hittable) */}
      <Pressable
        testID="editor-world-input"
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMiddleClick={onMiddleDown}
        onRightClick={onRightClick}
        onScroll={onScroll}
        style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#00000001' }}
      />

      {props.mapOverviewOpen ? (
        <MiniMap
          pieces={props.pieces}
          camera={{ x: stage.pose.centerX, z: stage.pose.centerZ, yawDegrees: stage.pose.yaw }}
          onCenter={centerFromMap}
          onClose={props.onToggleMap}
        />
      ) : null}
    </Box>
  );
}
