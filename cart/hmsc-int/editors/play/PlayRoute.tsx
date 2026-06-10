// editors/play/PlayRoute — /test + /build FOLDED (PLAYFOLD-0605): ONE embodied
// game surface, two MODES, F-key toggled. The user's ruling: "its the same
// game, one is just build mode, one is test mode. fold it so that i can just
// toggle between them with the F keys like f1 f2."
//
//   F1 = TEST mode   the /test lineage's mode layer, in full: the backtick
//                    GAME_COMMANDS console (gv_speed drives the real walk/run,
//                    pv_teleport adopts back into the pose), RMB ADS aim, the
//                    [probe-player-model] gait/rig diagnostic, Drop in.
//   F2 = BUILD mode  the /build lineage's mode layer, in full: registry-driven
//                    palette + ruled hotkeys (R rotate · E edit · 1 floor ·
//                    2 wall · 3 ramp · 4 roof · X remove · P mark · G grab ·
//                    0 prefabs · [ ] variant), crosshair→snap→ghost→place,
//                    prefab capture, the Fortnite-verbatim HUD (HUD-0605),
//                    live P2 tuning, one-interaction-one-commit sessions.
//
// ONE ROUTE (/test, the ProjectBar Play button), MODE IS ROUTE STATE: the
// /build URL retired once the fold made it a dupe (USER: "remove the one
// route that is now just a dupe of it"). F1/F2 set the mode in place — the
// substrate never remounts: pose, camera, mouse capture, the console session,
// and the placed pieces all carry across the flip. Build a ramp, F1, walk it,
// F2, keep building. ('/build' survives only as the session channel label and
// the twig storage keys — those are names, not URLs.)
//
// THE UNION IS DELIBERATE (fold contract — nothing dropped, additions only
// where the fold makes the surface coherent):
//   • placed pieces are SOLID and VISIBLE in both modes (the world stream's
//     materialized truth is the one world — testing what you built is the
//     point of the toggle).
//   • the backtick console opens in both modes (build hotkeys gate while it's
//     open); its ctx speeds drive the walk/run everywhere on this surface.
//   • RMB ADS aim stays test-mode (build keeps the ruled walk-only camera so
//     the crosshair law's Orbit solve stays the picking truth).
//
// Lineage: TestRoute.tsx (V23 camera/console/probe authority) + editors/build/
// BuildRoute.tsx (V24 creative build) — both folded here verbatim; their mode
// layers are this file's two halves. Substrate: ../../Embodied (SUBSTRATE-0605).

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Pressable, Scene3D, Text, TextInput } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import {
  GAME_BUILD, GAME_CAMERA, GAME_CHROME, GAME_COMMANDS, GAME_FIGURE, GAME_INPUT,
  GAME_ITEMS, GAME_LOOP, GAME_PHYSICS, GAME_TELEMETRY, GAME_WORLD, buildingsStream, cameraOcclusionResponse, pieceMutationMapName, piecesForMap, withBuildingPieces, worldStream,
} from '@game';
import type {
  BuildFaceSkin, BuildFaceSlot, BuildMaterial, BuildPieceDef, BuildPieceKind, BuildPrefabDef, BuildSkinSet, BuildingsStreamState, PieceRay,
  PlacedBuildPiece, WallEdit, WorldEvent, WorldStreamState,
} from '@game';
import type { GameState } from '../../../hmsc/design'; // GAP: retires when hmsc becomes compile/'s output (V15)
import {
  EmbodiedCaptures, EmbodiedMouseSurface, EmbodiedScene, PLAYER_CAMERA,
  groundColumnTop, normalizeYawDegrees, readEmbodiedCameraNode, useEmbodiedPlayer,
  type EmbodiedWorldExtras, type PlayerPose,
} from '../../Embodied';
import { EmbodiedHud, HUD_TUNING, type HudCompassMarker, type HudFeedEntry, type HudSlotDef } from '../../EmbodiedHud';
import { useChurn } from '../../perfLog';
import { C, accentFor } from '../../studio.cls';
import { editorChannel } from '../store';
import { editorSessions, type RouteSession } from '../sessions';
import { editorTunables } from '../tunables';
import { readRouteTwigState, useRouteTwigState, writeRouteTwigState } from '../twigs';
import { resolveSnapTarget, SNAP_TUNING_DEFAULTS, type SnapTarget } from '../build/snap';
import { TextureCapture } from '../../game/textures/registry';
// The build-piece RENDERER + its constants/probe live in shared modules now, so
// the iso authoring pane draws walls with the SAME renderer F2 uses (extraction
// PIECEMESH-0608; behavior identical — these are the verbatim definitions moved
// out of this file, re-imported here).
import { BUILD_UI, CAMERA_OCCLUSION_TUNING } from '../build/buildUi';
import { perfMs, warnPlaceFreeze, startPlaceFreezeProbe, markPlaceFreezeProbe, type PlaceFreezeProbe } from '../build/placeFreezeProbe';
import { pieceVisualShapes, VisualShapeMesh, PlacedPieceMeshes, type VisualShape } from '../build/pieceMeshes';

const DEG = Math.PI / 180;

export type PlayMode = 'test' | 'build';

const WORLD_STREAM_REV_POLL_MS = 250;

// ── TEST-mode presentation: the console overlay (route chrome; the SESSION is
//    captured — GAME_COMMANDS.createConsoleSession owns toggle/dispatch). ─────
const CONSOLE_UI = {
  heightPercent: '46%',
  backdrop: '#0b1220e8',
  maxVisibleLines: 22,
  lineColor: { input: '#93c5fd', output: '#d1fae5', error: '#fb7185' } as Record<string, string>,
} as const;

// BUILD_UI moved to ../build/buildUi (imported above). The live-tuning
// registration stays here — it mutates the same imported object every reader sees.
editorTunables().register({
  system: 'build-placed',
  route: '/test',
  table: GAME_BUILD.placed.tuning,
  specs: {
    rampWalkableSlopeCos: { label: 'ramp slope cos', min: 0.1, max: 1, step: 0.01, precision: 2 },
    rampSlabThicknessMeters: { label: 'ramp slab thick m', min: 0.05, max: 1, step: 0.01, precision: 2 },
    rampSlabEdgePlanThicknessMeters: { label: 'ramp edge lip m', min: 0.02, max: 0.5, step: 0.01, precision: 2 },
    rampSlabEdgeSegments: { label: 'ramp edge bands', min: 1, max: 32, step: 1, precision: 0 },
    verticalLinkHeightfieldCellMeters: { label: 'slope hf cell m', min: 0.2, max: 1.5, step: 0.1, precision: 1 },
  },
});
// CAMERA_OCCLUSION_TUNING moved to ../build/buildUi (imported above). Its
// live-tuning registration stays here, mutating the same imported object.
// How STRONG the wall/roof push-in is — every spring-arm knob, live from the
// settings menu (write-through to the imported table; updateCameraOcclusion
// reads it next frame). The fade knobs are gone with the fade.
editorTunables().register({
  system: 'play-camera-occlusion', route: '/test', table: CAMERA_OCCLUSION_TUNING,
  specs: {
    minDistanceMeters: { label: 'min camera m (push-in floor)', min: 0.3, max: 6, step: 0.05, precision: 2 },
    skinOffsetMeters: { label: 'wall gap m', min: 0.02, max: 0.5, step: 0.01, precision: 2 },
    pullSmoothingPerSecond: { label: 'push-in speed', min: 1, max: 80, step: 1, precision: 0 },
    sweepRadiusMeters: { label: 'probe thickness m', min: 0, max: 0.5, step: 0.01, precision: 2 },
    rampGroundToleranceMeters: { label: 'ramp ground tol m', min: 0.05, max: 0.8, step: 0.01, precision: 2 },
  },
});
// The base camera FEEL — how far back it sits, fov, look sensitivity, pitch
// limits. PLAYER_CAMERA is a live table (Embodied dropped its `as const`);
// distance/fov/target need the host re-pushed on edit, which onFrame does when
// the tunables revision moves (pitch limits + sensitivity are read live in
// applyLook already).
editorTunables().register({
  system: 'play-camera-feel', route: '/test', table: PLAYER_CAMERA,
  specs: {
    distanceMeters: { label: 'camera distance m', min: 2, max: 16, step: 0.05, precision: 2 },
    fovDegrees: { label: 'field of view', min: 30, max: 90, step: 1, precision: 0 },
    targetHeightMeters: { label: 'look height m', min: 0.5, max: 2.5, step: 0.05, precision: 2 },
    minPitchDegrees: { label: 'pitch down limit', min: -45, max: 20, step: 1, precision: 0 },
    maxPitchDegrees: { label: 'pitch up limit', min: 20, max: 89, step: 1, precision: 0 },
    yawDegreesPerPixel: { label: 'look sensitivity X', min: 0.02, max: 1, step: 0.01, precision: 2 },
    pitchDegreesPerPixel: { label: 'look sensitivity Y', min: 0.02, max: 1, step: 0.01, precision: 2 },
  },
});
const BUILD_KEYS = {
  selectTool: 'q',
} as const;

// perfMs + the place-freeze probe helpers moved to ../build/placeFreezeProbe
// (imported above) — shared with the iso authoring pane, one global probe seq.

// The ruled category hotkeys lead the palette (USER VERDICT: 1 floor, 2 wall,
// 3 ramp, 4 roof); every other registry kind follows in registry order. The
// registry stays the source of WHAT exists — this only orders the display,
// and the chips show the same numbers the keys answer to.
const RULED_HOTKEY_KINDS: readonly BuildPieceKind[] = ['floor', 'wall', 'ramp', 'roof'];
const PALETTE_KIND_ORDER: readonly BuildPieceKind[] = [
  ...RULED_HOTKEY_KINDS,
  ...GAME_BUILD.kinds.kinds.filter((kind) => !RULED_HOTKEY_KINDS.includes(kind)),
];

// MATERIAL_LOOK + SIGHTLINE_EDIT_OPACITY moved to ../build/pieceMeshes (the
// renderer that owns them).

const PLAYER_POSE_TWIG = {
  route: '/test',
  key: 'playerPose',
  version: 1,
  idleDebounceMs: 900,
  maxIntervalMs: 10000,
  minMoveMeters: 0.25,
  minYMoveMeters: 0.08,
  minYawDegrees: 3,
  minPitchDegrees: 3,
} as const;

type PlayerPoseTwig = {
  version: 1;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  grounded: boolean;
  savedAt: number;
};

type Armed =
  | { type: 'piece'; id: string }
  | { type: 'prefab'; id: string };

type BuildAction = 'place' | 'select';

// ── TEST-mode probe helpers ──────────────────────────────────────────────────

function dist3(a: readonly number[], b: readonly number[]): number {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function turnPlace(p: readonly number[], yawDeg: number, offset: readonly number[]): [number, number, number] {
  const rad = yawDeg * (Math.PI / 180);
  const c = Math.cos(rad), s = Math.sin(rad);
  return [p[0] * c + p[2] * s + offset[0], p[1] + offset[1], -p[0] * s + p[2] * c + offset[2]];
}

function movingAssemblyProbe(rig: ReturnType<typeof GAME_FIGURE.buildRigFrame>) {
  return rig.assembly.find((inst) => inst.bone === 'lUpperArm') ?? rig.assembly.find((inst) => inst.bone === 'lThigh') ?? rig.assembly[0];
}

function movingClothingProbe(rig: ReturnType<typeof GAME_FIGURE.buildRigFrame>) {
  return rig.clothing[3] ?? rig.clothing[0];
}

// The piece-visual types, RampSlabGeometry, localOffset, and visualLook moved to
// ../build/pieceMeshes (the shared renderer). pieceVisualShapes/VisualShapeMesh/
// PlacedPieceMeshes are imported from there.

function skinTextureIdsFromSet(set: BuildSkinSet | undefined, ids: Set<string>): void {
  if (!set) return;
  for (const slot of GAME_BUILD.skins.slots as readonly BuildFaceSlot[]) {
    const skin = set[slot];
    if (skin?.kind === 'material') ids.add(skin.id);
  }
}

function worldToPieceLocal(x: number, z: number, piece: { x: number; z: number; yawDegrees: number }): { u: number; v: number } {
  const yaw = piece.yawDegrees * DEG;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const dx = x - piece.x;
  const dz = z - piece.z;
  return { u: dx * cos - dz * sin, v: dx * sin + dz * cos };
}

function isPlayerStandingOnRamp(player: PlayerPose, piece: PlacedBuildPiece): boolean {
  const def = GAME_BUILD.catalog.get(piece.pieceId);
  if (def.kind !== 'ramp') return false;
  const size = def.size;
  const halfW = size.widthMeters / 2;
  const halfD = size.depthMeters / 2;
  const local = worldToPieceLocal(player.x, player.z, piece);
  if (local.u < -halfW || local.u > halfW || local.v < -halfD || local.v > halfD) return false;
  const t = (local.v + halfD) / size.depthMeters;
  const surfaceY = piece.y + t * size.heightMeters;
  return Math.abs(player.y - surfaceY) <= CAMERA_OCCLUSION_TUNING.rampGroundToleranceMeters;
}

// pieceVisualShapes, VisualBoxMesh/VisualRampMesh/VisualShapeMesh, and
// wallJoinSignature moved to ../build/pieceMeshes (imported above) — the one
// renderer the iso authoring pane shares.

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function envFlag(name: string): boolean {
  try {
    const fn = (globalThis as any).__env_get;
    const value = typeof fn === 'function' ? fn(name) : null;
    return value === '1' || value === 'true' || value === 'on';
  } catch {
    return false;
  }
}

function clampPitch(pitch: number): number {
  return Math.max(PLAYER_CAMERA.minPitchDegrees, Math.min(PLAYER_CAMERA.maxPitchDegrees, pitch));
}

function validatePlayerPoseTwig(value: unknown): PlayerPoseTwig | null {
  const raw = value as Partial<PlayerPoseTwig> | null;
  if (!raw || raw.version !== PLAYER_POSE_TWIG.version) return null;
  if (!finiteNumber(raw.x) || !finiteNumber(raw.y) || !finiteNumber(raw.z)) return null;
  if (!finiteNumber(raw.yaw) || !finiteNumber(raw.pitch)) return null;
  return {
    version: PLAYER_POSE_TWIG.version,
    x: raw.x,
    y: raw.y,
    z: raw.z,
    yaw: normalizeYawDegrees(raw.yaw),
    pitch: clampPitch(raw.pitch),
    grounded: raw.grounded !== false,
    savedAt: finiteNumber(raw.savedAt) ? raw.savedAt : Date.now(),
  };
}

function capturePlayerPoseTwig(player: PlayerPose, look: { yaw: number; pitch: number }): PlayerPoseTwig {
  return {
    version: PLAYER_POSE_TWIG.version,
    x: player.x,
    y: player.y,
    z: player.z,
    yaw: normalizeYawDegrees(player.yaw),
    pitch: clampPitch(look.pitch),
    grounded: player.grounded,
    savedAt: Date.now(),
  };
}

function angleDeltaDegrees(a: number, b: number): number {
  const delta = Math.abs(normalizeYawDegrees(a) - normalizeYawDegrees(b));
  return Math.min(delta, 360 - delta);
}

function playerPoseTwigChanged(a: PlayerPoseTwig, b: PlayerPoseTwig | null): boolean {
  if (!b) return true;
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz) >= PLAYER_POSE_TWIG.minMoveMeters
    || Math.abs(a.y - b.y) >= PLAYER_POSE_TWIG.minYMoveMeters
    || angleDeltaDegrees(a.yaw, b.yaw) >= PLAYER_POSE_TWIG.minYawDegrees
    || Math.abs(a.pitch - b.pitch) >= PLAYER_POSE_TWIG.minPitchDegrees
    || a.grounded !== b.grounded;
}

// PlacedPieceMesh + PlacedPieceMeshes (the standing-city renderer, rendered in
// BOTH modes) moved to ../build/pieceMeshes; PlacedPieceMeshes is imported above
// and shared with the iso authoring pane.

// ── chips (route chrome) ─────────────────────────────────────────────────────

/** HUD-family chip for the blueprint selection (tokens via studio.cls; the
 *  active state colors are raw values read through accentFor — user props are
 *  not token-resolved). */
function BlueprintChip(props: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress}>
      <C.HudPanel
        style={{
          paddingLeft: 7, paddingRight: 7, paddingTop: 3, paddingBottom: 3,
          ...(props.on ? { backgroundColor: accentFor('segActiveBg'), borderColor: accentFor('primary') } : {}),
        }}
      >
        <C.HudKeyTag style={props.on ? { color: accentFor('hudText') } : undefined}>{props.label}</C.HudKeyTag>
      </C.HudPanel>
    </Pressable>
  );
}

function Chip(props: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={props.onPress}
      style={{
        paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4,
        borderRadius: 5, borderWidth: 1,
        borderColor: props.on ? '#38bdf8' : '#27364a',
        backgroundColor: props.on ? '#0c4a6e' : '#0f1a2e',
      }}
    >
      <Text fontSize={10} color={props.on ? '#e0f2fe' : '#94a3b8'} style={{ fontWeight: 700 }}>{props.label}</Text>
    </Pressable>
  );
}

// ── the folded route ─────────────────────────────────────────────────────────

export function PlayRoute(props: {
  state: GameState;
  mapName: string;
  legacyPieceMapName?: string | null;
  onExit: () => void;
}) {
  // Mode is route state (ONE route since the /build dupe retired) — F1/F2
  // flip it in place, nothing remounts.
  const diagnosticBuildWalk = envFlag('HMSC_INT_DIAGNOSTIC_BUILD_WALK');
  const diagnosticBuildMode = diagnosticBuildWalk || envFlag('HMSC_INT_DIAGNOSTIC_BUILD_MODE');
  const [mode, setMode] = useState<PlayMode>(diagnosticBuildMode ? 'build' : 'test');
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const savedPlayerPoseRef = useRef<PlayerPoseTwig | null>(
    validatePlayerPoseTwig(readRouteTwigState<PlayerPoseTwig | null>(PLAYER_POSE_TWIG.route, PLAYER_POSE_TWIG.key, null)),
  );
  const lastSavedPlayerPoseRef = useRef<PlayerPoseTwig | null>(savedPlayerPoseRef.current);
  const lastPlayerPoseWriteMsRef = useRef(Date.now());
  const playerPoseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playerPoseRestoredRef = useRef(false);

  // ── the builder's session on the WORLD channel (the user's V20 ruling).
  //    Opened for the surface's lifetime — commits only flow from build-mode
  //    interactions; the '/build' channel id is the settings bus's name for it. ─
  const build = useMemo(() => {
    try {
      const channel = editorChannel(worldStream);
      // buildings (req_0513): the derived-stamp side of the pieces view; F2
      // commits stay on the world channel, this surface only READS instances.
      let buildings: { state: () => BuildingsStreamState; length: () => number } | null = null;
      try {
        buildings = editorChannel(buildingsStream);
      } catch {
        buildings = null;
      }
      return { channel, buildings, session: editorSessions().open('/build', channel) as RouteSession<WorldEvent>, error: null as string | null };
    } catch (error: any) {
      return { channel: null, buildings: null, session: null, error: String(error?.message ?? error) };
    }
  }, []);
  useEffect(() => () => build.session?.close(), [build]);

  // The stream's materialized state IS the placed-piece truth; rev bumps
  // after each commit and the route re-reads — no second copy anywhere.
  const [piecesRev, setPiecesRev] = useState(0);
  useEffect(() => {
    if (!build.channel) return undefined;
    // the combined log length: a building event must re-derive the pieces view
    // exactly like a world event does (req_0513).
    const combined = () => (build.channel?.length() ?? 0) + (build.buildings?.length() ?? 0);
    let lastLength = combined();
    const timer = setInterval(() => {
      const nextLength = combined();
      if (nextLength === lastLength) return;
      lastLength = nextLength;
      setPiecesRev((r) => r + 1);
    }, WORLD_STREAM_REV_POLL_MS);
    return () => clearInterval(timer);
  }, [build.channel, build.buildings]);
  const placeFreezeTraceEnabled = envFlag('HMSC_INT_PLACEFREEZE_TRACE') || envFlag('HMSC_INT_PLACEFREEZE_ONCE');
  const placeFreezeProbeRef = useRef<PlaceFreezeProbe | null>(null);
  const streamState: WorldStreamState | null = useMemo(() => {
    const t0 = perfMs();
    const state = build.channel ? build.channel.state() : null;
    markPlaceFreezeProbe(placeFreezeProbeRef.current, 'streamState', {
      piecesRev,
      piecesByMap: state?.piecesByMap?.[props.mapName]?.length ?? 0,
      globalPieces: state?.pieces?.length ?? 0,
      ms: perfMs() - t0,
    });
    return state;
  }, [build, piecesRev, props.mapName]);
  const buildingsState: BuildingsStreamState | null = useMemo(
    () => (build.buildings ? build.buildings.state() : null),
    [build, piecesRev],
  );
  const pieces = useMemo(() => {
    const t0 = perfMs();
    // loose world pieces ⊕ derived building stamps — the ONE pieces view
    // (req_0513), identical to the iso pane's and the compile's.
    const next = withBuildingPieces(
      piecesForMap(streamState, props.mapName, { legacyMapName: props.legacyPieceMapName }),
      buildingsState,
      props.mapName,
    );
    markPlaceFreezeProbe(placeFreezeProbeRef.current, 'piecesForMap', { pieces: next.length, ms: perfMs() - t0 });
    return next;
  }, [streamState, buildingsState, props.mapName, props.legacyPieceMapName]);
  // Flat-pad terrain lift (req_0444): the SAME idempotent transform the build pane and
  // compile use, so a building walked in F2 stands on the painted terrain exactly as it
  // does in the editor and the shipped game. Render, colliders, and camera occluders read
  // the LIFTED set; the crosshair edit path keeps the raw `pieces`/piecesRef.
  const liftedPieces = useMemo(
    () => GAME_BUILD.placed.liftToTerrain(pieces, (x, z) => groundColumnTop(state.world as Parameters<typeof groundColumnTop>[0], x, z)),
    [pieces, state.world],
  );
  const placedSkinTextureIds = useMemo(() => {
    const ids = new Set<string>();
    for (const piece of pieces) skinTextureIdsFromSet(piece.skin, ids);
    return [...ids].sort();
  }, [pieces]);
  const piecesRef = useRef(pieces);
  piecesRef.current = pieces;
  const cameraOccluders = useMemo(() => GAME_BUILD.placed.cameraOccluders(liftedPieces), [liftedPieces]);
  const cameraOccludersRef = useRef(cameraOccluders);
  cameraOccludersRef.current = cameraOccluders;
  const cameraOccluderOwners = useMemo(() => {
    const owners: Record<string, { pieceId: string; kind: BuildPieceKind; piece: PlacedBuildPiece }> = {};
    for (const piece of liftedPieces) {
      const def = GAME_BUILD.catalog.get(piece.pieceId);
      if (def) owners[piece.id] = { pieceId: piece.pieceId, kind: def.kind, piece };
    }
    return owners;
  }, [liftedPieces]);
  const cameraOccluderOwnersRef = useRef(cameraOccluderOwners);
  cameraOccluderOwnersRef.current = cameraOccluderOwners;
  useEffect(() => {
    GAME_PHYSICS.configureCameraOcclusion(cameraOccluders.rects, cameraOccluders.orientedRects);
  }, [cameraOccluders]);
  const [occludedPieceIds, setOccludedPieceIds] = useState<ReadonlySet<string>>(() => new Set());
  const occludedPieceKeyRef = useRef('');
  const cameraConstraintLastRef = useRef({ nodeId: 0, distance: Number.NaN, minDistance: Number.NaN, smoothing: Number.NaN });
  // A 'play-camera-feel' knob edit bumps the tunables revision; re-push the rig
  // params so the new distance/fov/look-height land live (normal play sends them
  // on pose change only). -1 forces the first frame to sync.
  const cameraFeelRevRef = useRef(-1);
  const cameraOcclusionDiagnosticLastRef = useRef({
    distance: Number.NaN,
    hitDistance: Number.NaN,
    nearestOwnerIndex: Number.NaN,
    hits: Number.NaN,
    rects: Number.NaN,
    orientedRects: Number.NaN,
    ownerId: '',
    ownerKind: '',
    hitRole: '',
    ignored: false,
    source: '',
  });
  const updateCameraOcclusionRef = useRef<() => void>(() => undefined);
  const [buildAction, setBuildAction] = useRouteTwigState<BuildAction>('/build', 'buildAction', 'place');
  const buildActionRef = useRef(buildAction);
  buildActionRef.current = buildAction;
  const buildTapRef = useRef<() => void>(() => undefined);
  const buildFrameRef = useRef<() => void>(() => undefined);

  // ── the player: the shared embodied substrate, fed BOTH lineages' options ──
  // Placed pieces join the world as solids + ramp/stairs heightfields in BOTH
  // modes (you built it, you can test it). The crosshair re-resolves on the
  // substrate's frame and a captured tap places — build mode only, gated at
  // call time through modeRef (the substrate reads options per frame).
  const worldExtras = useMemo<EmbodiedWorldExtras>(() => {
    const collidersT0 = perfMs();
    const solids = GAME_BUILD.placed.colliders(liftedPieces);
    const collidersMs = perfMs() - collidersT0;
    GAME_TELEMETRY.recordDiagnostic('physics', 'placement.colliders', {
      pieces: pieces.length,
      solids: solids.length,
      ms: collidersMs,
    });
    markPlaceFreezeProbe(placeFreezeProbeRef.current, 'colliders', { pieces: pieces.length, solids: solids.length, ms: collidersMs });
    warnPlaceFreeze('colliders', { pieces: pieces.length, solids: solids.length, ms: collidersMs });
    return {
      solids,
      registerHeightfields: (worldBake) => {
        const rampsT0 = perfMs();
        const ramps = GAME_BUILD.placed.ramps(liftedPieces, worldBake.fields.length);
        const rampsMs = perfMs() - rampsT0;
        const registerT0 = perfMs();
        let registered = 0;
        for (const field of ramps) {
          if (field.slot >= GAME_WORLD.heightfieldSlots) break;
          GAME_PHYSICS.registerHeightfield(field);
          registered += 1;
        }
        const registerMs = perfMs() - registerT0;
        const totalMs = rampsMs + registerMs;
        GAME_TELEMETRY.recordDiagnostic('physics', 'placement.heightfields', {
          pieces: pieces.length,
          bakedWorldFields: worldBake.fields.length,
          ramps: ramps.length,
          registered,
          rampsMs,
          registerMs,
          totalMs,
        });
        markPlaceFreezeProbe(placeFreezeProbeRef.current, 'heightfields', {
          pieces: pieces.length,
          bakedWorldFields: worldBake.fields.length,
          ramps: ramps.length,
          registered,
          rampsMs,
          registerMs,
          totalMs,
        });
        warnPlaceFreeze('heightfields', {
          pieces: pieces.length,
          bakedWorldFields: worldBake.fields.length,
          ramps: ramps.length,
          registered,
          rampsMs,
          registerMs,
          totalMs,
        });
        if (registered < ramps.length) console.warn(`[play] ${ramps.length - registered} ramp slopes past the heightfield slots`);
      },
    };
  }, [liftedPieces]);
  const [floorEdgeGrace, setFloorEdgeGrace] = useRouteTwigState(
    '/build',
    'floorEdgeGraceMeters',
    GAME_PHYSICS.tuning.walkableRectSidePushGraceMeters,
  );
  const embodied = useEmbodiedPlayer({
    state: props.state,
    figureCartKey: 'hmscint.play.player',
    logTag: '[play]',
    // RMB ADS stays the test lineage's layer; build keeps the ruled walk-only
    // camera (the crosshair law's Orbit solve is the picking truth). The
    // substrate handles a mid-aim mode flip (aim option read per frame).
    aim: mode === 'test',
    isTyping: () => gameConsole.session.isOpen(),
    speeds: () => gameConsole.ctx.player,
    worldExtras,
    physicsTuning: () => ({
      ...props.state.config.physics,
      walkableRectSidePushGraceMeters: floorEdgeGrace,
    }),
    onFrame: () => {
      updateCameraOcclusionRef.current();
      if (modeRef.current !== 'build') return;
      refreshSnapRef.current();
      buildFrameRef.current();
    },
    onTap: () => { if (modeRef.current === 'build') buildTapRef.current(); },
    playerJitProbe: diagnosticBuildWalk,
  });
  const { player, playerRef, lookRef, rig, figureOffset, pointerWire, worldGrid } = embodied;
  const flushPlayerPose = () => {
    const next = capturePlayerPoseTwig(playerRef.current, lookRef.current);
    if (!playerPoseTwigChanged(next, lastSavedPlayerPoseRef.current)) return;
    writeRouteTwigState(PLAYER_POSE_TWIG.route, PLAYER_POSE_TWIG.key, next);
    lastSavedPlayerPoseRef.current = next;
    lastPlayerPoseWriteMsRef.current = Date.now();
  };
  const flushPlayerPoseRef = useRef(flushPlayerPose);
  flushPlayerPoseRef.current = flushPlayerPose;

  useEffect(() => {
    if (playerPoseRestoredRef.current) return;
    playerPoseRestoredRef.current = true;
    const saved = savedPlayerPoseRef.current;
    if (!saved) return;
    const current = playerRef.current;
    const groundY = groundColumnTop(worldGrid, saved.x, saved.z);
    const restoredY = saved.y < groundY - props.state.config.physics.playerCapsuleHeightMeters ? groundY : saved.y;
    if (restoredY !== saved.y) {
      console.warn('[play] restored player pose was below the live floor; snapping to ground', {
        savedY: saved.y,
        groundY,
        x: saved.x,
        z: saved.z,
      });
    }
    lookRef.current.yaw = saved.yaw;
    lookRef.current.pitch = saved.pitch;
    embodied.adoptPose({
      ...current,
      x: saved.x,
      y: restoredY,
      z: saved.z,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: saved.yaw,
      grounded: restoredY !== saved.y || saved.grounded,
      moving: false,
      running: false,
    });
  }, []);

  useEffect(() => {
    if (!playerPoseRestoredRef.current) return;
    const next = capturePlayerPoseTwig(playerRef.current, lookRef.current);
    if (!playerPoseTwigChanged(next, lastSavedPlayerPoseRef.current)) return;

    if (Date.now() - lastPlayerPoseWriteMsRef.current >= PLAYER_POSE_TWIG.maxIntervalMs) {
      if (playerPoseTimerRef.current) clearTimeout(playerPoseTimerRef.current);
      playerPoseTimerRef.current = null;
      flushPlayerPoseRef.current();
      return;
    }

    if (playerPoseTimerRef.current) clearTimeout(playerPoseTimerRef.current);
    playerPoseTimerRef.current = setTimeout(() => {
      playerPoseTimerRef.current = null;
      flushPlayerPoseRef.current();
    }, PLAYER_POSE_TWIG.idleDebounceMs);
    return () => {
      if (playerPoseTimerRef.current) clearTimeout(playerPoseTimerRef.current);
      playerPoseTimerRef.current = null;
    };
  }, [player.x, player.y, player.z, player.yaw, player.grounded]);

  useEffect(() => () => {
    if (playerPoseTimerRef.current) clearTimeout(playerPoseTimerRef.current);
    playerPoseTimerRef.current = null;
    flushPlayerPoseRef.current();
  }, []);

  // ── F1/F2: the mode toggle (the fold's reason to exist) — route state,
  //    flipped in place; no remount, the pose and the world carry across. ───
  useEffect(() => {
    const off = GAME_INPUT.onKeyDown((event) => {
      const key = String(event?.key ?? '').toLowerCase();
      if (key === 'f1') setMode('test');
      if (key === 'f2') setMode('build');
    });
    return off;
  }, []);

  // ════ TEST lineage: the backtick console (CS idiom) ═══════════════════════
  // Available in BOTH modes (the fold's union): the session is the captured
  // GAME_COMMANDS console over a per-mount GameCommandState seeded from the
  // authored map (world slice COPIED — the console edits its own copy;
  // rendered-world unification is the world lane's integration ticket). Pose
  // syncs in before each command (pv_where tells the truth) and position
  // changes adopt back out (pv_teleport/pv_respawn move the player). Its ctx
  // speeds drive the real walk/run everywhere on this surface (gv_speed).
  const gameConsole = useMemo(() => {
    type GameCtx = ReturnType<typeof GAME_COMMANDS.createGameState>;
    const registry = GAME_COMMANDS.createRegistry<GameCtx>();
    GAME_COMMANDS.defineGameCommands(registry);
    const ctx = GAME_COMMANDS.createGameState();
    ctx.player.walkSpeedMetersPerSecond = props.state.player.walkSpeedMetersPerSecond;
    ctx.player.runSpeedMetersPerSecond = props.state.player.runSpeedMetersPerSecond;
    ctx.world.cellSizeMeters = props.state.world.cellSizeMeters;
    ctx.world.surfaceRegions = [...props.state.world.surfaceRegions] as GameCtx['world']['surfaceRegions'];
    ctx.world.placedCells = { ...props.state.world.placedCells } as GameCtx['world']['placedCells'];
    ctx.world.landforms = [...(props.state.world.landforms ?? [])] as GameCtx['world']['landforms'];
    const session = GAME_COMMANDS.createConsoleSession(registry, ctx, {
      beforeRun: (c) => {
        const p = playerRef.current;
        c.player.position = { x: p.x, y: p.y, z: p.z };
        c.player.yawDegrees = p.yaw;
        c.player.physics.velocity = { x: p.vx, y: p.vy, z: p.vz };
        c.player.physics.grounded = p.grounded;
      },
      afterRun: (c) => {
        const p = playerRef.current;
        const moved =
          Math.abs(c.player.position.x - p.x) > 1e-6 ||
          Math.abs(c.player.position.y - p.y) > 1e-6 ||
          Math.abs(c.player.position.z - p.z) > 1e-6;
        if (moved) {
          const next: PlayerPose = {
            ...p,
            x: c.player.position.x, y: c.player.position.y, z: c.player.position.z,
            vx: 0, vy: 0, vz: 0,
            yaw: normalizeYawDegrees(c.player.yawDegrees),
          };
          embodied.adoptPose(next); // teleport — the camera follows
        }
      },
    });
    return { ctx, session };
  }, [props.state]);
  // Mirror the session's revision into React state so the overlay re-renders
  // on toggle/typing/output. The game KEEPS PLAYING — nothing here pauses the
  // frame loop; it only gates key reads while open (the substrate's isTyping).
  const [, setConsoleRev] = useState(0);
  const consoleOpen = gameConsole.session.isOpen();
  useEffect(() => {
    const offDown = GAME_INPUT.onKeyDown((event) => {
      const before = gameConsole.session.revision();
      gameConsole.session.handleKey(event ?? {});
      if (gameConsole.session.revision() !== before) setConsoleRev(gameConsole.session.revision());
    });
    // keyups re-arm the toggle edge (one physical press = exactly one flip;
    // the engine bus delivers SDL key repeats unfiltered).
    const offUp = GAME_INPUT.onKeyUp((event) => gameConsole.session.handleKeyUp(event ?? {}));
    return () => {
      offDown();
      offUp();
    };
  }, [gameConsole]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!gameConsole.session.isOpen() && gameConsole.session.watches().length === 0) return;
      const before = gameConsole.session.revision();
      gameConsole.session.update(0.5);
      if (gameConsole.session.revision() !== before) setConsoleRev(gameConsole.session.revision());
    }, 500);
    return () => clearInterval(timer);
  }, [gameConsole]);

  // ════ TEST lineage: the [probe-player-model] gait/rig diagnostic ══════════
  // Runs in test mode only (its lineage); build mode clears the last samples
  // so re-entering test never reads a phantom mega-delta.
  const playerProbeRef = useRef({
    lastLog: 0,
    frames: 0,
    rootMoves: 0,
    assemblyMoves: 0,
    clothingMoves: 0,
    assemblyLocalMoves: 0,
    clothingLocalMoves: 0,
    dtSum: 0,
    maxRootDelta: 0,
    maxAssemblyDelta: 0,
    maxClothingDelta: 0,
    maxAssemblyLocalDelta: 0,
    maxClothingLocalDelta: 0,
    zeroAssemblyLocalWhileRoot: 0,
    zeroClothingLocalWhileRoot: 0,
    lastRoot: null as [number, number, number] | null,
    lastAssembly: null as [number, number, number] | null,
    lastClothing: null as [number, number, number] | null,
    lastAssemblyLocal: null as [number, number, number] | null,
    lastClothingLocal: null as [number, number, number] | null,
    lastRenderNow: 0,
  });
  useEffect(() => {
    const probe = playerProbeRef.current;
    if (mode !== 'test') {
      probe.lastRoot = null;
      probe.lastAssembly = null;
      probe.lastClothing = null;
      probe.lastAssemblyLocal = null;
      probe.lastClothingLocal = null;
      probe.lastRenderNow = 0;
      return;
    }
    const now = GAME_LOOP.now();
    const dtMs = probe.lastRenderNow > 0 ? now - probe.lastRenderNow : 0;
    probe.lastRenderNow = now;
    const root = figureOffset;
    const assemblySample = movingAssemblyProbe(rig);
    const clothingSample = movingClothingProbe(rig);
    const assemblyLocal = turnPlace(assemblySample?.position ?? [0, 0, 0], player.yaw, [0, 0, 0]);
    const clothingLocal = turnPlace(clothingSample?.position ?? assemblySample?.position ?? [0, 0, 0], player.yaw, [0, 0, 0]);
    const assembly = turnPlace(assemblySample?.position ?? [0, 0, 0], player.yaw, figureOffset);
    const clothing = turnPlace(clothingSample?.position ?? assemblySample?.position ?? [0, 0, 0], player.yaw, figureOffset);
    if (probe.lastRoot && probe.lastAssembly && probe.lastClothing && probe.lastAssemblyLocal && probe.lastClothingLocal) {
      const rootDelta = dist3(root, probe.lastRoot);
      const assemblyDelta = dist3(assembly, probe.lastAssembly);
      const clothingDelta = dist3(clothing, probe.lastClothing);
      const assemblyLocalDelta = dist3(assemblyLocal, probe.lastAssemblyLocal);
      const clothingLocalDelta = dist3(clothingLocal, probe.lastClothingLocal);
      probe.frames += 1;
      probe.dtSum += dtMs;
      if (rootDelta > 1e-5) probe.rootMoves += 1;
      if (assemblyDelta > 1e-5) probe.assemblyMoves += 1;
      if (clothingDelta > 1e-5) probe.clothingMoves += 1;
      if (assemblyLocalDelta > 1e-5) probe.assemblyLocalMoves += 1;
      if (clothingLocalDelta > 1e-5) probe.clothingLocalMoves += 1;
      if (rootDelta > 1e-5 && assemblyLocalDelta <= 1e-5) probe.zeroAssemblyLocalWhileRoot += 1;
      if (rootDelta > 1e-5 && clothingLocalDelta <= 1e-5) probe.zeroClothingLocalWhileRoot += 1;
      probe.maxRootDelta = Math.max(probe.maxRootDelta, rootDelta);
      probe.maxAssemblyDelta = Math.max(probe.maxAssemblyDelta, assemblyDelta);
      probe.maxClothingDelta = Math.max(probe.maxClothingDelta, clothingDelta);
      probe.maxAssemblyLocalDelta = Math.max(probe.maxAssemblyLocalDelta, assemblyLocalDelta);
      probe.maxClothingLocalDelta = Math.max(probe.maxClothingLocalDelta, clothingLocalDelta);
    }
    probe.lastRoot = [...root] as [number, number, number];
    probe.lastAssembly = assembly;
    probe.lastClothing = clothing;
    probe.lastAssemblyLocal = assemblyLocal;
    probe.lastClothingLocal = clothingLocal;
    if (now - probe.lastLog >= 1000 && probe.frames > 0) {
      console.log(
        `[probe-player-model] frames=${probe.frames} avgRenderDtMs=${(probe.dtSum / probe.frames).toFixed(2)} ` +
        `rootMoves=${probe.rootMoves} assemblyWorldMoves=${probe.assemblyMoves} clothingWorldMoves=${probe.clothingMoves} ` +
        `assemblyLocalMoves=${probe.assemblyLocalMoves} clothingLocalMoves=${probe.clothingLocalMoves} ` +
        `zeroAssemblyLocalWhileRoot=${probe.zeroAssemblyLocalWhileRoot} zeroClothingLocalWhileRoot=${probe.zeroClothingLocalWhileRoot} ` +
        `maxRootDelta=${probe.maxRootDelta.toFixed(4)} maxAssemblyWorldDelta=${probe.maxAssemblyDelta.toFixed(4)} maxClothingWorldDelta=${probe.maxClothingDelta.toFixed(4)} ` +
        `maxAssemblyLocalDelta=${probe.maxAssemblyLocalDelta.toFixed(4)} maxClothingLocalDelta=${probe.maxClothingLocalDelta.toFixed(4)} ` +
        `root=(${root.map((n) => n.toFixed(3)).join(',')}) assemblyProbe=(${assembly.map((n) => n.toFixed(3)).join(',')}) clothingProbe=(${clothing.map((n) => n.toFixed(3)).join(',')})`,
      );
      probe.lastLog = now;
      probe.frames = 0;
      probe.rootMoves = 0;
      probe.assemblyMoves = 0;
      probe.clothingMoves = 0;
      probe.assemblyLocalMoves = 0;
      probe.clothingLocalMoves = 0;
      probe.dtSum = 0;
      probe.maxRootDelta = 0;
      probe.maxAssemblyDelta = 0;
      probe.maxClothingDelta = 0;
      probe.maxAssemblyLocalDelta = 0;
      probe.maxClothingLocalDelta = 0;
      probe.zeroAssemblyLocalWhileRoot = 0;
      probe.zeroClothingLocalWhileRoot = 0;
    }
  }, [figureOffset, player.yaw, rig, mode]);

  // ════ BUILD lineage: live tuning (P2 in-interface; '/build' twig keys keep
  //      every saved value from the pre-fold route) ══════════════════════════
  const [reachMeters, setReachMeters] = useRouteTwigState('/build', 'reachMeters', SNAP_TUNING_DEFAULTS.reachMeters);
  const [ghostOpacity, setGhostOpacity] = useRouteTwigState<number>('/build', 'ghostOpacity', BUILD_UI.ghostOpacity);
  const [marchStep, setMarchStep] = useRouteTwigState('/build', 'marchStep', SNAP_TUNING_DEFAULTS.groundMarchStepMeters);
  const [edgeAnchorTolerance, setEdgeAnchorTolerance] = useRouteTwigState('/build', 'edgeAnchorToleranceMeters', SNAP_TUNING_DEFAULTS.edgeAnchorToleranceMeters);
  const [showTuning, setShowTuning] = useRouteTwigState('/build', 'showTuning', false);
  const snapTuning = useMemo(() => ({
    ...SNAP_TUNING_DEFAULTS,
    reachMeters,
    groundMarchStepMeters: marchStep,
    edgeAnchorToleranceMeters: edgeAnchorTolerance,
  }), [reachMeters, marchStep, edgeAnchorTolerance]);
  const snapTuningRef = useRef(snapTuning);
  snapTuningRef.current = snapTuning;

  // ── the palette (registry-driven: the catalog is the source) ──────────────
  const kinds = PALETTE_KIND_ORDER;
  const prefabDefs = useMemo<BuildPrefabDef[]>(() => [
    ...GAME_BUILD.prefabs.ids.map((id) => GAME_BUILD.prefabs.get(id)),
    ...Object.values(streamState?.prefabs ?? {}),
  ], [streamState]);
  const [armed, setArmed] = useRouteTwigState<Armed>('/build', 'armed', (() => {
    const first = GAME_BUILD.catalog.byKind(kinds[0])[0];
    return { type: 'piece', id: first.id };
  })());
  const armedRef = useRef(armed);
  armedRef.current = armed;
  const armedDef: BuildPieceDef | null = armed.type === 'piece' ? GAME_BUILD.catalog.get(armed.id) : null;
  const armedPrefab: BuildPrefabDef | null = armed.type === 'prefab' ? (prefabDefs.find((d) => d.id === armed.id) ?? null) : null;
  const armedKind: BuildPieceKind | 'prefab' = armed.type === 'prefab' ? 'prefab' : armedDef!.kind;
  const entriesOfArmedKind = armedKind === 'prefab' ? [] : GAME_BUILD.catalog.byKind(armedKind);
  const prefabDefsRef = useRef(prefabDefs);
  prefabDefsRef.current = prefabDefs;

  const armKind = (kind: BuildPieceKind | 'prefab') => {
    if (kind === 'prefab') {
      const first = prefabDefsRef.current[0];
      if (first) setArmed({ type: 'prefab', id: first.id });
      return;
    }
    const first = GAME_BUILD.catalog.byKind(kind)[0];
    if (first) setArmed({ type: 'piece', id: first.id });
  };
  const cycleEntry = (direction: 1 | -1) => {
    const current = armedRef.current;
    if (current.type === 'prefab') {
      const list = prefabDefsRef.current;
      if (list.length === 0) return;
      const index = Math.max(0, list.findIndex((d) => d.id === current.id));
      setArmed({ type: 'prefab', id: list[(index + direction + list.length) % list.length].id });
      return;
    }
    const list = GAME_BUILD.catalog.byKind(GAME_BUILD.catalog.get(current.id).kind);
    const index = Math.max(0, list.findIndex((d) => d.id === current.id));
    setArmed({ type: 'piece', id: list[(index + direction + list.length) % list.length].id });
  };

  // ghost rotation (R) — a ref for the frame loop + state for the HUD
  const [ghostYaw, setGhostYaw] = useRouteTwigState('/build', 'ghostYaw', 0);
  const ghostYawRef = useRef(ghostYaw);

  // ── crosshair → snap target (recomputed on the substrate's frame, published
  //    only when the SNAPPED result changes — quantized values make that cheap) ─
  const [snapTarget, setSnapTarget] = useState<SnapTarget | null>(null);
  const snapTargetRef = useRef<SnapTarget | null>(null);
  const snapKeyRef = useRef('');

  // The crosshair law: the screen-center axis of the camera the renderer is
  // consuming. The substrate's look shadow + PLAYER_CAMERA are the SAME
  // values the native controller was parameterized with, so this JS solve is
  // registry math for PICKING only — the render drive stays host-side (V23).
  const crosshairRay = (): PieceRay => {
    const p = playerRef.current;
    const l = lookRef.current;
    const solved = GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, {
      target: [p.x, p.y + PLAYER_CAMERA.targetHeightMeters, p.z],
      yaw: l.yaw,
      pitch: l.pitch,
      dist: PLAYER_CAMERA.distanceMeters,
      fov: PLAYER_CAMERA.fovDegrees,
    });
    const dx = solved.target[0] - solved.pos[0];
    const dy = solved.target[1] - solved.pos[1];
    const dz = solved.target[2] - solved.pos[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    return {
      origin: { x: solved.pos[0], y: solved.pos[1], z: solved.pos[2] },
      dir: { x: dx / len, y: dy / len, z: dz / len },
    };
  };
  const crosshairRayRef = useRef(crosshairRay);
  crosshairRayRef.current = crosshairRay;

  const setResidualOcclusionIds = (ids: readonly string[]) => {
    if (ids.length === 0) {
      if (occludedPieceKeyRef.current === '') return;
      occludedPieceKeyRef.current = '';
      setOccludedPieceIds(new Set());
      return;
    }
    const key = [...ids].sort().join('|');
    if (key === occludedPieceKeyRef.current) return;
    occludedPieceKeyRef.current = key;
    setOccludedPieceIds(new Set(ids));
  };

  const applyCameraDistanceConstraint = (distanceMeters: number) => {
    const distance = Number.isFinite(distanceMeters) ? Math.max(CAMERA_OCCLUSION_TUNING.minDistanceMeters, distanceMeters) : PLAYER_CAMERA.distanceMeters;
    const nodeId = Number((embodied.cameraRef.current as any)?.id ?? 0);
    if (!Number.isFinite(nodeId) || nodeId <= 0) return;
    const minDistance = CAMERA_OCCLUSION_TUNING.minDistanceMeters;
    const smoothing = CAMERA_OCCLUSION_TUNING.pullSmoothingPerSecond;
    const last = cameraConstraintLastRef.current;
    if (
      last.nodeId === nodeId
      && Math.abs(last.distance - distance) < 0.001
      && Math.abs(last.minDistance - minDistance) < 0.001
      && Math.abs(last.smoothing - smoothing) < 0.1
    ) return;
    last.nodeId = nodeId;
    last.distance = distance;
    last.minDistance = minDistance;
    last.smoothing = smoothing;
    embodied.setCameraDistanceConstraint(
      distance,
      minDistance,
      smoothing,
    );
  };

  const updateCameraOcclusion = () => {
    // Live camera-feel: if a tunable changed, re-push the rig params so a
    // distance/fov/look-height edit applies this frame.
    const rev = editorTunables().revision();
    if (rev !== cameraFeelRevRef.current) {
      cameraFeelRevRef.current = rev;
      embodied.resendCameraParams();
    }
    const occluders = cameraOccludersRef.current;
    // The spring-arm follows whichever rig is LIVE (walk Orbit / ADS Aim): cast
    // from the player-side pivot out to that rig's natural eye, and PUSH the eye
    // in to the player's side of any wall/roof on that line. Never see-through.
    const cam = embodied.desiredCamera();
    if (occluders.ownerIds.length === 0) {
      applyCameraDistanceConstraint(cam.baseDistance);
      return;
    }
    const p = playerRef.current;
    const eye = cam.eye;
    const pivot = cam.pivot;
    // Nearest hit -> how far in to pull. Walls/roofs (and non-floor ramps) push
    // the camera in; the floor/ramp the player stands on never does. The pull-in
    // distance is clamped to the active rig's base so ADS keeps its tight framing
    // and walk keeps its reach.
    const pushInDistance = (hitDistance: number, ownerIndex: number) => {
      const ownerId = ownerIndex > 0 ? occluders.ownerIds[ownerIndex - 1] ?? '' : '';
      const meta = ownerId ? cameraOccluderOwnersRef.current[ownerId] : null;
      const kind = meta?.kind ?? (hitDistance > 0 ? 'unknown' : 'none');
      const isPlayerGround = kind === 'ramp' && meta ? isPlayerStandingOnRamp(p, meta.piece) : false;
      const occludes = kind === 'wall' || kind === 'roof' || (kind === 'ramp' && !isPlayerGround);
      const distance = hitDistance > 0 && occludes
        ? Math.max(CAMERA_OCCLUSION_TUNING.minDistanceMeters, Math.min(cam.baseDistance, hitDistance - CAMERA_OCCLUSION_TUNING.skinOffsetMeters))
        : cam.baseDistance;
      return { distance, ownerId, ownerKind: kind, occludes };
    };
    const recordPullDiagnostic = (source: string, distance: number, hitDistance: number, ownerIndex: number, ownerId: string, ownerKind: string, occludes: boolean, hostUs: number) => {
      const diagnostic = cameraOcclusionDiagnosticLastRef.current;
      if (
        diagnostic.source !== source
        || Math.abs(diagnostic.distance - distance) >= 0.001
        || Math.abs(diagnostic.hitDistance - hitDistance) >= 0.001
        || diagnostic.nearestOwnerIndex !== ownerIndex
        || diagnostic.ownerId !== ownerId
        || diagnostic.ownerKind !== ownerKind
      ) {
        diagnostic.source = source;
        diagnostic.distance = distance;
        diagnostic.hitDistance = hitDistance;
        diagnostic.nearestOwnerIndex = ownerIndex;
        diagnostic.hits = hitDistance > 0 ? 1 : 0;
        diagnostic.rects = occluders.rects.length;
        diagnostic.orientedRects = occluders.orientedRects.length;
        diagnostic.ownerId = ownerId;
        diagnostic.ownerKind = ownerKind;
        diagnostic.ignored = hitDistance > 0 && !occludes;
        GAME_TELEMETRY.recordDiagnostic('camera', 'cameraOcclusion.changed', {
          hits: hitDistance > 0 ? 1 : 0,
          hostUs,
          safeDistance: distance,
          nearestTargetDistance: hitDistance,
          nearestOwnerIndex: ownerIndex,
          ownerId,
          ownerKind,
          occludes,
          aiming: cam.aiming,
          baseDistance: cam.baseDistance,
          rects: occluders.rects.length,
          orientedRects: occluders.orientedRects.length,
          cameraSource: source,
        });
      }
    };
    // Fast path: the configured stored-scene query (no per-frame array repack).
    const hit = GAME_PHYSICS.cameraOcclusionConfiguredHit(
      eye.x, eye.y, eye.z, pivot.x, pivot.y, pivot.z, CAMERA_OCCLUSION_TUNING.sweepRadiusMeters,
    );
    if (hit !== null) {
      const r = pushInDistance(hit.nearestTargetDistanceMeters, hit.nearestOwnerIndex);
      applyCameraDistanceConstraint(r.distance);
      recordPullDiagnostic('configured', r.distance, hit.nearestTargetDistanceMeters, hit.nearestOwnerIndex, r.ownerId, r.ownerKind, r.occludes, hit.hostMicroseconds);
      return;
    }
    // Fallback: array-fed query (host without the configured fast path).
    const result = GAME_PHYSICS.cameraOcclusion({
      camera: eye,
      target: pivot,
      rects: occluders.rects,
      orientedRects: occluders.orientedRects,
      maxHits: CAMERA_OCCLUSION_TUNING.maxHits,
      radiusMeters: CAMERA_OCCLUSION_TUNING.sweepRadiusMeters,
    });
    if (!result) {
      applyCameraDistanceConstraint(cam.baseDistance);
      return;
    }
    const r = pushInDistance(result.nearestTargetDistanceMeters, result.nearestOwnerIndex);
    applyCameraDistanceConstraint(r.distance);
    recordPullDiagnostic('fallback', r.distance, result.nearestTargetDistanceMeters, result.nearestOwnerIndex, r.ownerId, r.ownerKind, r.occludes, result.hostMicroseconds);
  };
  updateCameraOcclusionRef.current = updateCameraOcclusion;

  const refreshSnapTarget = () => {
    const current = armedRef.current;
    const def = current.type === 'piece' ? GAME_BUILD.catalog.get(current.id) : null;
    // prefab stamps drop on the grid; pieces use their OWN catalog snap mode
    const snap = def ? def.snap : 'grid';
    const size = def ? def.size : { widthMeters: 1, heightMeters: 3, depthMeters: 1 };
    const target = resolveSnapTarget({
      ray: crosshairRayRef.current(),
      pieces: piecesRef.current,
      groundTopAt: (x, z) => groundColumnTop(worldGrid, x, z),
      snap,
      size,
      yawDegrees: ghostYawRef.current,
      tuning: snapTuningRef.current,
    });
    const key = target
      ? `${target.surface}:${target.placement.x.toFixed(3)},${target.placement.y.toFixed(3)},${target.placement.z.toFixed(3)},${target.placement.yawDegrees}:${target.targetPieceId ?? ''}`
      : 'none';
    if (key !== snapKeyRef.current) {
      snapKeyRef.current = key;
      snapTargetRef.current = target;
      setSnapTarget(target);
    }
  };
  const refreshSnapRef = useRef(refreshSnapTarget);
  refreshSnapRef.current = refreshSnapTarget;

  // Churn probe for the embodied game surface itself. Off by default through
  // GAME_TELEMETRY; `log churn on` makes it name which route-level values are
  // driving PlayRoute renders while the player/camera/game surface is active.
  useChurn('PlayRoute', {
    mode,
    playerX: player.x,
    playerY: player.y,
    playerZ: player.z,
    playerYaw: player.yaw,
    mouseCaptured: embodied.mouseCaptured,
    piecesRev,
    pieceCount: pieces.length,
    snapKey: snapKeyRef.current,
  });

  // ── one commit per interaction (the editors/sessions ruling) ──────────────
  const scopedBuildEvent = (event: WorldEvent): WorldEvent => {
    switch (event.kind) {
      case 'piecePlaced':
      case 'prefabStamped':
        return { ...event, mapName: props.mapName } as WorldEvent;
      case 'pieceRemoved':
      case 'pieceEditSet':
      case 'pieceSkinSet': {
        const mapName = pieceMutationMapName(streamState, props.mapName, props.legacyPieceMapName, event.id);
        return mapName ? ({ ...event, mapName } as WorldEvent) : event;
      }
      default:
        return event;
    }
  };
  const commit = (event: WorldEvent, label: string): boolean => {
    if (!build.session) return false;
    const probe = placeFreezeProbeRef.current;
    markPlaceFreezeProbe(probe, 'commit.begin', { kind: event.kind, label });
    const t0 = perfMs();
    const scopedT0 = perfMs();
    const scoped = scopedBuildEvent(event);
    const scopedMs = perfMs() - scopedT0;
    markPlaceFreezeProbe(probe, 'commit.scoped', { kind: event.kind, scopedMs });
    const sessionT0 = perfMs();
    const pos = build.session.commit(scoped, label);
    const sessionMs = perfMs() - sessionT0;
    markPlaceFreezeProbe(probe, 'commit.session', { kind: event.kind, seq: pos.globalSeq, sessionMs });
    const revT0 = perfMs();
    setPiecesRev((r) => r + 1);
    const revMs = perfMs() - revT0;
    const totalMs = perfMs() - t0;
    markPlaceFreezeProbe(probe, 'commit.done', { kind: event.kind, seq: pos.globalSeq, scopedMs, sessionMs, setRevMs: revMs, totalMs });
    GAME_TELEMETRY.recordDiagnostic('worldStream', 'placement.commit', {
      kind: event.kind,
      label,
      piecesBefore: piecesRef.current.length,
      seq: pos.globalSeq,
      scopedMs,
      sessionMs,
      setRevMs: revMs,
      totalMs,
    });
    warnPlaceFreeze('commit', {
      kind: event.kind,
      piecesBefore: piecesRef.current.length,
      seq: pos.globalSeq,
      scopedMs,
      sessionMs,
      setRevMs: revMs,
      totalMs,
    });
    return true;
  };

  const place = () => {
    const target = snapTargetRef.current;
    if (!target || !build.session) return;
    const current = armedRef.current;
    const at = `${target.placement.x.toFixed(1)},${target.placement.z.toFixed(1)}`;
    if (current.type === 'prefab') {
      const def = prefabDefsRef.current.find((d) => d.id === current.id);
      if (!def) return;
      commit(
        { kind: 'prefabStamped', prefabId: def.id, origin: { x: target.placement.x, y: target.placement.y, z: target.placement.z }, yawDegrees: target.placement.yawDegrees },
        `stamped ${def.label} @ ${at}`,
      );
      return;
    }
    const def = GAME_BUILD.catalog.get(current.id);
    const placement = {
      pieceId: def.id,
      x: target.placement.x,
      y: target.placement.y,
      z: target.placement.z,
      yawDegrees: target.placement.yawDegrees,
    };
    const problems = GAME_BUILD.placed.validatePlacement(placement);
    if (problems.length > 0) {
      console.warn(`[play] placement refused: ${problems.join('; ')}`);
      return;
    }
    if (placeFreezeTraceEnabled) {
      placeFreezeProbeRef.current = startPlaceFreezeProbe(`place:${def.id}`, piecesRef.current.length);
      markPlaceFreezeProbe(placeFreezeProbeRef.current, 'snap.accept', {
        pieceId: def.id,
        x: placement.x,
        y: placement.y,
        z: placement.z,
        yawDegrees: placement.yawDegrees,
        surface: target.surface,
      });
    }
    commit({ kind: 'piecePlaced', placement }, `placed ${def.label} @ ${at}`);
  };
  const placeRef = useRef(place);
  placeRef.current = place;

  const placeFreezeAutoDoneRef = useRef(false);
  useEffect(() => {
    if (!envFlag('HMSC_INT_PLACEFREEZE_ONCE') || placeFreezeAutoDoneRef.current || !build.session) return;
    placeFreezeAutoDoneRef.current = true;
    GAME_TELEMETRY.clearDiagnostics();
    GAME_TELEMETRY.setDiagnosticChannel('worldStream', true);
    GAME_TELEMETRY.setDiagnosticChannel('physics', true);
    GAME_TELEMETRY.setDiagnosticChannel('draw', true);
    GAME_TELEMETRY.setDiagnosticChannel('frame', true);
    GAME_TELEMETRY.setDiagnosticChannel('hostFlush', true);
    GAME_TELEMETRY.setDiagnosticChannel('bridge', true);
    const timer = setTimeout(() => {
      const def = GAME_BUILD.catalog.get('floor.concrete.common');
      const placement = { pieceId: def.id, x: 6000, y: 0, z: 6000, yawDegrees: 0 };
      placeFreezeProbeRef.current = startPlaceFreezeProbe(`auto:${def.id}`, piecesRef.current.length);
      markPlaceFreezeProbe(placeFreezeProbeRef.current, 'auto.accept', {
        dataRoot: String((globalThis as any).__env_get?.('HMSC_INT_DATA_ROOT') ?? 'cart/hmsc-int/data'),
        mapName: props.mapName,
        pieceId: def.id,
        x: placement.x,
        y: placement.y,
        z: placement.z,
      });
      commit({ kind: 'piecePlaced', placement }, `placefreeze probe ${def.label}`);
      setTimeout(() => {
        markPlaceFreezeProbe(placeFreezeProbeRef.current, 'auto.flushDiagnostics');
        GAME_TELEMETRY.flushDiagnosticChannel('worldStream');
        GAME_TELEMETRY.flushDiagnosticChannel('physics');
        GAME_TELEMETRY.flushDiagnosticChannel('draw');
        GAME_TELEMETRY.flushDiagnosticChannel('frame');
        GAME_TELEMETRY.flushDiagnosticChannel('hostFlush');
        GAME_TELEMETRY.flushDiagnosticChannel('bridge');
        GAME_TELEMETRY.flushDiagnostics();
      }, 1800);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [build.session]);

  // ── prefab capture (P marks → name → save) ────────────────────────────────
  const [markedIdList, setMarkedIdList] = useRouteTwigState<string[]>('/build', 'markedIds', []);
  const markedIds = useMemo<ReadonlySet<string>>(() => new Set(markedIdList), [markedIdList]);
  const setMarkedIds = (next: ReadonlySet<string> | ((prev: ReadonlySet<string>) => ReadonlySet<string>)): void => {
    setMarkedIdList((prevList) => {
      const prevSet = new Set(prevList);
      const nextSet = typeof next === 'function' ? next(prevSet) : next;
      return [...nextSet];
    });
  };
  const markedRef = useRef(markedIds);
  markedRef.current = markedIds;
  const [prefabName, setPrefabName] = useRouteTwigState('/build', 'prefabName', '');

  const savePrefab = () => {
    const ids = markedRef.current;
    if (!build.session || ids.size === 0) return;
    const composition = piecesRef.current.filter((p) => ids.has(p.id));
    const label = prefabName.trim() || `Prefab ${prefabDefsRef.current.length + 1}`;
    let id = GAME_BUILD.placed.mintPrefabId(label);
    let suffix = 2;
    while (prefabDefsRef.current.some((d) => d.id === id)) id = `${GAME_BUILD.placed.mintPrefabId(label)}${suffix++}`;
    const def = GAME_BUILD.placed.prefabFromPieces(id, label, 'common', composition);
    const problems = GAME_BUILD.prefabs.validate({ [def.id]: def });
    if (problems.length > 0) {
      console.warn(`[play] prefab refused: ${problems.join('; ')}`);
      return;
    }
    commit({ kind: 'prefabDefined', def }, `prefab ${label} (${composition.length} pieces)`);
    setMarkedIds(new Set());
    setPrefabName('');
    setBuildAction('place');
    setArmed({ type: 'prefab', id: def.id }); // clone → stamp, one motion
  };

  const selectGestureRef = useRef<{ active: boolean; mode: 'add' | 'erase'; lastId: string | null }>({
    active: false,
    mode: 'add',
    lastId: null,
  });
  const applyMarkedPiece = (targetId: string, mode: 'add' | 'erase') => {
    setMarkedIds((prev) => {
      const next = new Set(prev);
      if (mode === 'add') next.add(targetId);
      else next.delete(targetId);
      return next;
    });
  };
  const beginSelectGesture = () => {
    const targetId = snapTargetRef.current?.targetPieceId ?? null;
    if (!targetId) {
      if (markedRef.current.size > 0) setMarkedIds(new Set());
      selectGestureRef.current = { active: false, mode: 'add', lastId: null };
      return;
    }
    const mode = markedRef.current.has(targetId) ? 'erase' : 'add';
    applyMarkedPiece(targetId, mode);
    selectGestureRef.current = { active: true, mode, lastId: targetId };
  };
  const updateSelectGesture = () => {
    if (buildActionRef.current !== 'select') {
      selectGestureRef.current.active = false;
      return;
    }
    const leftDown = GAME_INPUT.readPointer().leftDown;
    if (!leftDown) {
      selectGestureRef.current.active = false;
      selectGestureRef.current.lastId = null;
      return;
    }
    const gesture = selectGestureRef.current;
    if (!gesture.active) return;
    const targetId = snapTargetRef.current?.targetPieceId ?? null;
    if (!targetId || targetId === gesture.lastId) return;
    applyMarkedPiece(targetId, gesture.mode);
    gesture.lastId = targetId;
  };
  buildTapRef.current = () => {
    if (buildActionRef.current === 'select') {
      beginSelectGesture();
      return;
    }
    placeRef.current();
  };
  buildFrameRef.current = updateSelectGesture;

  // ── the builder keys (route chrome; typing-gated AND build-mode-gated —
  //    the open console owns printables in either mode). USER-RULED hotkeys:
  //    R rotate · E edit · 1 floor · 2 wall · 3 ramp · 4 roof ────────────────
  useEffect(() => {
    const off = GAME_INPUT.onKeyDown((event) => {
      if (modeRef.current !== 'build') return;
      if (GAME_INPUT.isTextEditing()) return;
      if (gameConsole.session.isOpen()) return;
      const key = String(event?.key ?? '').toLowerCase();
      if (key >= '1' && key <= '9') {
        const index = Number(key) - 1;
        if (index < kinds.length) {
          setBuildAction('place');
          armKind(kinds[index]);
        }
        return;
      }
      if (key === '0') {
        setBuildAction('place');
        armKind('prefab');
        return;
      }
      if (key === BUILD_KEYS.selectTool) {
        selectGestureRef.current = { active: false, mode: 'add', lastId: null };
        setBuildAction((action) => action === 'select' ? 'place' : 'select');
        return;
      }
      if (key === '[') { cycleEntry(-1); return; }
      if (key === ']') { cycleEntry(1); return; }
      if (key === 'r') {
        ghostYawRef.current = normalizeYawDegrees(ghostYawRef.current + 90);
        setGhostYaw(ghostYawRef.current);
        refreshSnapRef.current();
        return;
      }
      const targetId = snapTargetRef.current?.targetPieceId ?? null;
      if (key === 'e' && targetId) {
        const piece = piecesRef.current.find((p) => p.id === targetId);
        if (!piece || !GAME_BUILD.placed.acceptsEdits(piece)) return;
        const edits = GAME_BUILD.edits.wallEdits;
        const next = edits[(edits.indexOf(piece.edit ?? 'solid') + 1) % edits.length];
        commit({ kind: 'pieceEditSet', id: piece.id, edit: next }, `${piece.id}: edit → ${next}`);
        return;
      }
      if (key === 'x' && targetId) {
        commit({ kind: 'pieceRemoved', id: targetId }, `removed ${targetId}`);
        setMarkedIds((prev) => {
          if (!prev.has(targetId)) return prev;
          const next = new Set(prev);
          next.delete(targetId);
          return next;
        });
        return;
      }
      if (key === 'p' && targetId) {
        setMarkedIds((prev) => {
          const next = new Set(prev);
          if (next.has(targetId)) next.delete(targetId);
          else next.add(targetId);
          return next;
        });
        return;
      }
      // SMARTSEL-0605: G grabs the whole connected shape under the crosshair
      // (every piece transitively touching the target). Pressing G on a shape
      // that is already fully marked unmarks it — the P toggle, shape-sized.
      if (key === 'g' && targetId) {
        const shape = GAME_BUILD.placed.connected(targetId, piecesRef.current);
        if (shape.size === 0) return;
        setMarkedIds((prev) => {
          let allMarked = true;
          for (const id of shape) if (!prev.has(id)) { allMarked = false; break; }
          const next = new Set(prev);
          for (const id of shape) {
            if (allMarked) next.delete(id);
            else next.add(id);
          }
          return next;
        });
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── ghost shapes for the armed selection at the snap target ───────────────
  const ghostShapes = useMemo<VisualShape[]>(() => {
    if (!snapTarget) return [];
    const p = snapTarget.placement;
    if (armedPrefab) {
      const stamped = GAME_BUILD.placed.stamp(armedPrefab, { x: p.x, y: p.y, z: p.z }, p.yawDegrees);
      const supportPieces = [...piecesRef.current, ...stamped.map((piece, index) => ({ id: `ghost.${index}`, ...piece }))];
      return stamped.flatMap((piece, index) => pieceVisualShapes(piece, `ghost.${index}`, supportPieces));
    }
    if (armedDef) {
      return pieceVisualShapes({ pieceId: armedDef.id, x: p.x, y: p.y, z: p.z, yawDegrees: p.yawDegrees }, 'ghost', piecesRef.current);
    }
    return [];
  }, [snapTarget, armedDef, armedPrefab]);

  // session history strip: the labeled commits prove one-interaction-one-commit
  const sessionCommits = useMemo(() => {
    if (!build.session) return [];
    const record = editorSessions().state().sessions[build.session.id];
    return record ? record.commits : [];
  }, [build, piecesRev]);

  const armedLabel = armedPrefab ? `${armedPrefab.label} (prefab)` : armedDef ? armedDef.label : '—';
  const targetPiece = snapTarget?.targetPieceId ? pieces.find((p) => p.id === snapTarget.targetPieceId) ?? null : null;
  const inBuild = mode === 'build';
  const showPlacementGhost = inBuild && buildAction === 'place';
  const showSelectionOverlay = inBuild && buildAction === 'select';
  const aimHint = pointerWire.complete ? 'RMB aim' : `aim unavailable (host missing: ${pointerWire.missing.join(', ')})`;
  const buildActionHint = buildAction === 'select'
    ? 'SELECT · click/drag mark · click empty clears'
    : 'PLACE · click place';
  const modeHintText = inBuild
    ? `${props.mapName} · BUILD (F1 test) · click to capture the mouse · WASD move · Space jump · ${buildActionHint} · ${BUILD_KEYS.selectTool.toUpperCase()} select · R rotate · E edit · X remove · P mark · G grab shape · 0 prefabs · [ ] variant · Esc frees the mouse`
    : `${props.mapName} · TEST (F2 build) · WASD move · Space jump · Shift run · mouse look (click/Esc capture) · \` console · ${aimHint}`;

  // ── HUD data (HUD-0605) — every datum through a door ──────────────────────
  // compass + minimap marker: the build target IS this route's live objective
  const hudMarkers = useMemo<HudCompassMarker[]>(
    () => (snapTarget ? [{ x: snapTarget.placement.x, z: snapTarget.placement.z, label: 'target' }] : []),
    [snapTarget],
  );
  // game status updates: the session's labeled commits (the V20 truth channel)
  const hudFeed = useMemo<HudFeedEntry[]>(() => {
    const tail = sessionCommits.slice(-HUD_TUNING.feed.maxLines);
    return tail.map((c, index) => ({ id: c.seq, text: `#${c.seq} ${c.label}`, hot: index === tail.length - 1 }));
  }, [sessionCommits]);
  // equipment: the authored inventory through the items door (empty = honest)
  const hudEquipment = useMemo<HudSlotDef[]>(
    () => (props.state.player.inventory ?? []).slice(0, HUD_TUNING.equipment.slotCount).map((id, index) => ({
      id: `${index}:${id}`,
      label: GAME_ITEMS.is(id) ? GAME_ITEMS.get(id).label : id,
    })),
    [props.state],
  );
  const hudKeyInfo = useMemo(() => [
    { label: 'map', value: props.mapName },
    { label: 'pieces', value: String(pieces.length) },
    { label: 'commits', value: String(sessionCommits.length) },
    { label: 'armed', value: armedLabel },
  ], [props.mapName, pieces.length, sessionCommits.length, armedLabel]);
  const hudMapBlips = useMemo(() => pieces.map((p) => ({ x: p.x, z: p.z })), [pieces]);

  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#080d16' }}>
      {placedSkinTextureIds.map((id) => (
        <TextureCapture
          key={id}
          textureId={id}
          staticKey={`bldskin:${id}`}
          widthPx={BUILD_UI.buildingSkinTexturePx}
          heightPx={BUILD_UI.buildingSkinTexturePx}
          cols={1}
          floors={1}
          perception={props.state.player.perception}
        />
      ))}
      <EmbodiedCaptures embodied={embodied} />
      <EmbodiedScene embodied={embodied}>
        {/* the standing pieces — the world stream's materialized truth, in
            BOTH modes (solid in both; the toggle exists to walk what you built) */}
        <PlacedPieceMeshes pieces={liftedPieces} markedIds={markedIds} targetId={showSelectionOverlay ? snapTarget?.targetPieceId ?? null : null} occludedIds={occludedPieceIds} placeFreezeProbe={placeFreezeProbeRef.current} />
        {/* the snap indicator + placement ghost are PLACE-mode language only.
            Select mode keeps the hover/selected piece highlights above. */}
        {showPlacementGhost && snapTarget && (
          <Scene3D.Mesh
            geometry={Geometry.Box}
            params={{ width: 1, height: 1, depth: 1 }}
            scale={[BUILD_UI.indicatorSizeMeters, BUILD_UI.indicatorSizeMeters, BUILD_UI.indicatorSizeMeters]}
            position={[snapTarget.hit.x, snapTarget.hit.y, snapTarget.hit.z]}
            material={{ color: BUILD_UI.ghostColor }}
          />
        )}
        {showPlacementGhost && ghostShapes.map((shape) => (
          <VisualShapeMesh
            key={shape.kind === 'ramp' ? shape.ramp.key : shape.box.key}
            shape={shape}
            colorOverride={BUILD_UI.ghostColor}
            opacityOverride={ghostOpacity}
          />
        ))}
      </EmbodiedScene>

      {/* crosshair (build) — centered by the wrapper (absolute left/top take
          no %), BEFORE the gesture Pressable so the center click still places */}
      {inBuild && (
        <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          <Box style={{ width: 2, height: 14, backgroundColor: '#e0f2fe88' }} />
          <Box style={{ width: 14, height: 2, backgroundColor: '#e0f2fe88', marginTop: -8 }} />
        </Box>
      )}

      <EmbodiedMouseSurface embodied={embodied} />

      {/* THE GAME HUD (HUD-0605 — Fortnite-verbatim layout, USER ruling) —
          build mode only. The blueprint selection (the ruled 1/2/3/4
          categories + variants) rides the bottom-right slot above the hotbar. */}
      {inBuild && (
        <EmbodiedHud
          embodied={embodied}
          markers={hudMarkers}
          feed={hudFeed}
          vitals={{ health: props.state.player.health }}
          keyInfo={hudKeyInfo}
          mapBlips={hudMapBlips}
          equipment={hudEquipment}
          blueprint={
            <Box style={{ alignItems: 'flex-end', gap: 4, maxWidth: 470 }}>
              {/* variants of the armed category (or the prefab shelf) */}
              <Box style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {armedKind === 'prefab'
                  ? prefabDefs.map((def) => (
                      <BlueprintChip key={def.id} label={def.label} on={armed.type === 'prefab' && armed.id === def.id} onPress={() => { setBuildAction('place'); setArmed({ type: 'prefab', id: def.id }); }} />
                    ))
                  : entriesOfArmedKind.map((def) => (
                      <BlueprintChip key={def.id} label={`${def.label} · ${def.theme}`} on={armed.type === 'piece' && armed.id === def.id} onPress={() => { setBuildAction('place'); setArmed({ type: 'piece', id: def.id }); }} />
                    ))}
              </Box>
              {/* categories — the registry IS the list, USER-RULED order leads
                  (1 floor · 2 wall · 3 ramp · 4 roof), keys and chips agree */}
              <Box style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {kinds.map((kind, index) => (
                  <BlueprintChip
                    key={kind}
                    label={`${index < 9 ? `${index + 1} ` : ''}${GAME_BUILD.kinds.get(kind).label}`}
                    on={armedKind === kind}
                    onPress={() => { setBuildAction('place'); armKind(kind); }}
                  />
                ))}
                <BlueprintChip label="0 Prefabs" on={armedKind === 'prefab'} onPress={() => { setBuildAction('place'); armKind('prefab'); }} />
              </Box>
              <C.HudTextDim>
                {`armed: ${armedLabel} · yaw ${ghostYaw}° · ${snapTarget ? `${snapTarget.surface}${targetPiece ? ` → ${GAME_BUILD.catalog.get(targetPiece.pieceId).label}${targetPiece.edit ? ` [${targetPiece.edit}]` : ''}` : ''}` : 'no target'}`}
              </C.HudTextDim>
            </Box>
          }
        />
      )}

      {/* route chrome (top-left; Fortnite keeps this corner quiet): Back is
          both modes; Drop in is test's; the tuning chip is build's. The help
          lines teach each lineage's keys plus the fold's F1/F2 toggle. */}
      <Box debugName="PlayRouteHintBar" style={{ position: 'absolute', left: 12, top: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable onPress={props.onExit} style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 6, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f1a2e' }}>
          <Text fontSize={11} color="#cbd5e1" style={{ fontWeight: 700 }}>Back</Text>
        </Pressable>
        {!inBuild && (
          <Pressable onPress={embodied.resetPlayer} style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 6, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f1a2e' }}>
            <Text fontSize={11} color="#cbd5e1" style={{ fontWeight: 700 }}>Drop in</Text>
          </Pressable>
        )}
        {inBuild && <Chip label="tuning" on={showTuning} onPress={() => setShowTuning((s) => !s)} />}
        <Text debugName="PlayModeHint" fontSize={10} color="#64748b" style={{ fontFamily: 'monospace' }}>{modeHintText}</Text>
      </Box>
      {inBuild && build.error != null && (
        <Box style={{ position: 'absolute', left: 12, top: 44, backgroundColor: '#7f1d1dcc', borderRadius: 6, paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4 }}>
          <Text fontSize={10} color="#fecaca" style={{ fontFamily: 'monospace' }}>{`persistence host missing — placements disabled (${build.error})`}</Text>
        </Box>
      )}
      {inBuild && showTuning && (
        <Box style={{ position: 'absolute', left: 12, top: 44, backgroundColor: BUILD_UI.panelBg, borderWidth: 1, borderColor: '#27364a', borderRadius: 8, padding: 10, gap: 6, width: 240 }}>
          <GAME_CHROME.Knob label="build reach (m)" value={reachMeters} spec={{ min: 4, max: 30, step: 1, precision: 0 }} onChange={setReachMeters} />
          <GAME_CHROME.Knob label="ghost opacity" value={ghostOpacity} spec={{ min: 0.1, max: 0.9, step: 0.05, precision: 2 }} onChange={setGhostOpacity} />
          <GAME_CHROME.Knob label="ground march (m)" value={marchStep} spec={{ min: 0.1, max: 1, step: 0.05, precision: 2 }} onChange={setMarchStep} />
          <GAME_CHROME.Knob label="edge top tol (m)" value={edgeAnchorTolerance} spec={{ min: 0, max: 0.1, step: 0.005, precision: 3 }} onChange={setEdgeAnchorTolerance} />
          <GAME_CHROME.Knob label="floor edge grace (m)" value={floorEdgeGrace} spec={GAME_PHYSICS.tuning.knobs.walkableRectSidePushGraceMeters} onChange={setFloorEdgeGrace} />
        </Box>
      )}

      {/* prefab capture panel (build) — appears while pieces are marked (sits
          above the bottom-right blueprint/hotbar stack) */}
      {inBuild && markedIds.size > 0 && (
        <Box style={{ position: 'absolute', right: 12, bottom: 190, backgroundColor: BUILD_UI.panelBg, borderWidth: 1, borderColor: '#facc15', borderRadius: 8, padding: 10, gap: 6, width: 240 }}>
          <Text fontSize={10} color="#fde68a" style={{ fontWeight: 700 }}>{`${markedIds.size} piece${markedIds.size === 1 ? '' : 's'} selected (Select: click/drag · P one · G shape)`}</Text>
          <TextInput
            value={prefabName}
            onChangeText={setPrefabName}
            placeholder="prefab name…"
            style={{ backgroundColor: '#0f1a2e', borderWidth: 1, borderColor: '#27364a', borderRadius: 4, paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3, color: '#e2e8f0', fontSize: 11 }}
          />
          <Box style={{ flexDirection: 'row', gap: 6 }}>
            <Chip label="Save prefab" on={true} onPress={savePrefab} />
            <Chip label="Clear marks" on={false} onPress={() => setMarkedIds(new Set())} />
          </Box>
        </Box>
      )}

      {/* The console overlay — root's LAST child (overlays-last hit-test rule),
          BOTH modes (the fold's union). Absolute over the top portion (CS
          style): the Scene3D underneath keeps its exact size — nothing
          reflows; the game keeps playing under it. */}
      {consoleOpen && (
        <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, height: CONSOLE_UI.heightPercent, backgroundColor: CONSOLE_UI.backdrop, borderBottomWidth: 2, borderBottomColor: '#334155', paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8 }}>
          <Box style={{ flexGrow: 1, justifyContent: 'flex-end', overflow: 'hidden', gap: 2 }}>
            {gameConsole.session.scrollOffset() > 0 && (
              <Text fontSize={10} color="#64748b" style={{ fontFamily: 'monospace' }}>
                {`— scrollback (${gameConsole.session.scrollOffset()} lines up) · PgDn to return —`}
              </Text>
            )}
            {gameConsole.session.watches().map((watch, index) => (
              <Text key={`watch-${index}`} fontSize={11} color="#fbbf24" style={{ fontFamily: 'monospace', lineHeight: 15 }}>
                {`[${index + 1}] (${watch.mode}) ${watch.expr} = ${watch.lastResult}`}
              </Text>
            ))}
            {gameConsole.session.visibleTail(CONSOLE_UI.maxVisibleLines).map((line) => (
              <Text key={line.id} fontSize={12} color={CONSOLE_UI.lineColor[line.kind]} style={{ fontFamily: 'monospace', lineHeight: 16 }}>
                {line.text}
              </Text>
            ))}
          </Box>
          <Box style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#1f2937', paddingTop: 6, marginTop: 6 }}>
            <Text fontSize={12} color="#fbbf24" style={{ fontFamily: 'monospace', fontWeight: 700 }}>
              {`] ${gameConsole.session.buffer()}▌`}
            </Text>
            <Text fontSize={10} color="#475569" style={{ fontFamily: 'monospace' }}>
              help · ↑↓ history · PgUp/PgDn scroll
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
