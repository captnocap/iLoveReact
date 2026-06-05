// editors/build/BuildRoute — /build: CREATIVE BUILD MODE (V24). Build the map
// WHILE PLAYING: Fortnite-Creative semantics on /test's embodied drop-in.
//
// One surface, two vocabularies:
//   the PLAYER   — /test's exact pattern: GAME_INPUT key transport, the V23
//                  native camera (host owns every frame), GAME_PHYSICS host
//                  step against GAME_WORLD colliders + heightfields.
//   the BUILDER  — crosshair (the solved camera's screen-center axis — the
//                  crosshair law) → snap target (./snap, the catalog entry's
//                  OWN snap mode); registry-driven palette (GAME_BUILD —
//                  never a hardcoded list); ghost preview; click places;
//                  E cycles the WallEdit vocabulary on the targeted piece;
//                  P marks pieces → a named prefab → stamp anywhere.
//
// ONE MODEL, TWO VIEWS (the V24 invariant): nothing here puts "build mode"
// in the data. A placement is a plain world-stream event; the session commit
// (editors/sessions — one interaction = ONE labeled commit on the WORLD
// channel) is the only trace that an embodied mode authored it. The stream's
// materialized state is the one placed-piece truth — this route re-reads it
// after every commit and keeps no second copy.
//
// GAP(W-2)/(W-3): world render + sky still reach into cart/hmsc/render3d,
// marked exactly as TestRoute marks them — they move behind the world lanes
// when those captures land.
//
// Numbers are TUNING DATA (P2): snap/ghost/camera values live in named
// tables below and the reach/ghost/march knobs are LIVE in the in-route
// tuning panel — tweak while playing, never re-code.

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Pressable, Scene3D, Text, TextInput } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import {
  GAME_BUILD, GAME_CAMERA, GAME_CHROME, GAME_FIGURE, GAME_INPUT, GAME_KINDS,
  GAME_LOOP, GAME_NATIVE_CAMERA, GAME_PHYSICS, GAME_WORLD, PHYSICS_LIMITS, worldStream,
} from '@game';
import type {
  BuildMaterial, BuildPieceDef, BuildPieceKind, BuildPrefabDef, PieceRay,
  PlacedBuildPiece, WallEdit, WorldEvent, WorldGridState, WorldStreamState,
} from '@game';
import { CharacterCaptures, FigureMeshes, buildPartRender } from '@game/figure/render';
import type { GameState, Vec3 } from '../../../hmsc/design'; // GAP: retires when hmsc becomes compile/'s output (V15)
import { WorldStatics } from '../../../hmsc/render3d/GameWorld3D'; // GAP(W-2)
import { TileSurfaceCaptures } from '../../../hmsc/render3d/tileSurface'; // GAP(W-2)
import { RoadSurfaceCaptures } from '../../../hmsc/render3d/Road'; // GAP(W-2)
import { RoadJunctionCaptures } from '../../../hmsc/render3d/RoadJunctions'; // GAP(W-2)
import { LandformSurfaceCaptures } from '../../../hmsc/render3d/Landform'; // GAP(W-2)
import { BuildingSurfaceCaptures } from '../../../hmsc/render3d/BuildingFacades'; // GAP(W-2)
import { PropSurfaceCaptures } from '../../../hmsc/render3d/PropCaptures'; // GAP(W-2)
import { WorldPartCaptures } from '../../../hmsc/render3d/PartCaptures'; // GAP(W-2)
import { DriveInScreenCaptures } from '../../../hmsc/render3d/driveInScreen'; // GAP(W-2)
import { hmscSkyBackgroundColor } from '../../../hmsc/render3d/sky'; // GAP(W-3)
import { editorChannel } from '../store';
import { editorSessions, type RouteSession } from '../sessions';
import { resolveSnapTarget, SNAP_TUNING_DEFAULTS, type SnapTarget } from './snap';

const DEG = Math.PI / 180;

// ── route presentation/feel data (P2: named values, no inline numbers) ───────
// Camera reproduces /test's proven boot frame; the live knobs below let the
// user tune the BUILD feel in-interface.
const CAMERA = {
  distanceMeters: 7.65,
  initialPitchDegrees: 17.8,
  minPitchDegrees: -10,
  maxPitchDegrees: 62,
  targetHeightMeters: 1.45,
  fovDegrees: 52,
  yawDegreesPerPixel: 0.28,
  pitchDegreesPerPixel: 0.22,
} as const;
const GAIT = {
  walkCyclesPerSecond: 1.6,
  runCyclesPerSecond: 2.3,
  framesPerCycle: 12,
} as const;
const FRAME = { minDtSeconds: 0.001, maxDtSeconds: 0.05 } as const;
const PLAYER_FIGURE_SEED = 1;
const PLAYER_FIGURE_CART_KEY = 'hmscint.build.player';
const IDLE_REST_EPSILON = 1e-4;

const BUILD_UI = {
  /** mouse-up within this many pixels of mouse-down = a click, not a drag */
  clickSlopPixels: 4,
  ghostOpacity: 0.45,
  ghostColor: '#7dd3fc',
  ghostBlockedColor: '#fb7185',
  markColor: '#fbbf24',
  targetColor: '#a5f3fc',
  /** the snap indicator cube's edge, meters */
  indicatorSizeMeters: 0.14,
  /** ramp/stairs render as this many stepped boxes (visual only — collision
   *  is the real heightfield slope) */
  rampVisualSteps: 4,
  paletteBg: '#0b1220e0',
  panelBg: '#0f1a2ef0',
} as const;

// How each material READS (display table — gameplay truth stays in the
// catalog tags; glass opacity matches the materials.ts family look).
const MATERIAL_LOOK: Record<BuildMaterial, { color: string; opacity?: number }> = {
  concrete: { color: '#9aa3ad' },
  brick: { color: '#8a4a3a' },
  stucco: { color: '#d8cdb8' },
  wood: { color: '#8a6a45' },
  metal: { color: '#7d858d' },
  glass: { color: '#cfe6f2', opacity: 0.3 },
  chainlink: { color: '#b9c2c9', opacity: 0.45 },
};
const SIGHTLINE_EDIT_OPACITY: Partial<Record<WallEdit, number>> = {
  window: 0.35,
  doubleWindow: 0.3,
  brokenWindow: 0.12,
};

const PlayerMeshes = memo(FigureMeshes);

type PlayerPose = {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  grounded: boolean;
  yaw: number;
  moving: boolean;
  running: boolean;
  gaitPhase: number;
};

type Armed =
  | { type: 'piece'; id: string }
  | { type: 'prefab'; id: string };

const FALLBACK_SURFACE = GAME_KINDS.tiles.get('road').surface;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function normalizeYawDegrees(yawDegrees: number): number {
  return ((yawDegrees % 360) + 360) % 360;
}

// The authored GameState's world slice as the door's view (TestRoute's W-1
// pattern — route glue over door functions, no second world model).
function worldGridOf(state: GameState): WorldGridState {
  return {
    cellSizeMeters: state.world.cellSizeMeters,
    surfaceRegions: state.world.surfaceRegions as unknown as WorldGridState['surfaceRegions'],
    placedCells: state.world.placedCells as unknown as WorldGridState['placedCells'],
    landforms: (state.world.landforms ?? []) as unknown as WorldGridState['landforms'],
  };
}

// Highest standable top at (x, z) — the spawn/snap ground column (TestRoute's
// spawnGroundTop, the same door math).
function groundColumnTop(world: WorldGridState, x: number, z: number): number {
  let top = 0;
  const c = world.cellSizeMeters;
  for (const r of world.surfaceRegions) {
    if (x >= r.x * c && x <= (r.x + r.width) * c && z >= r.z * c && z <= (r.z + r.depth) * c) {
      top = Math.max(top, GAME_WORLD.surfaceRegionTopMeters(r, c));
    }
  }
  return Math.max(top, GAME_WORLD.landformGroundTopAt(world, x, z) ?? top);
}

function initialPlayer(state: GameState, world: WorldGridState): PlayerPose {
  const p = state.player;
  const y = groundColumnTop(world, p.position.x, p.position.z);
  return {
    x: p.position.x, y, z: p.position.z,
    vx: 0, vy: 0, vz: 0, grounded: true,
    yaw: p.yawDegrees, moving: false, running: false, gaitPhase: 0,
  };
}

// ── piece visuals: the same meaning the colliders carry, as boxes ────────────

type VisualBox = {
  key: string;
  cx: number; cy: number; cz: number;
  sx: number; sy: number; sz: number;
  yawDegrees: number;
  color: string;
  opacity?: number;
};

/** local (u along width, v along depth) → world offset, R(+yaw) — the same
 *  frame the colliders/raycast/stamp rotate with. */
function localOffset(u: number, v: number, yawDegrees: number): { dx: number; dz: number } {
  const cos = Math.cos(yawDegrees * DEG);
  const sin = Math.sin(yawDegrees * DEG);
  return { dx: u * cos - v * sin, dz: u * sin + v * cos };
}

function pieceVisualBoxes(
  piece: { pieceId: string; x: number; y: number; z: number; yawDegrees: number; edit?: WallEdit },
  key: string,
): VisualBox[] {
  const def = GAME_BUILD.catalog.get(piece.pieceId);
  const look = MATERIAL_LOOK[def.material];
  const size = def.size;
  const yaw = piece.yawDegrees;
  const box = (k: string, u: number, baseY: number, w: number, h: number, opacity?: number): VisualBox => {
    const { dx, dz } = localOffset(u, 0, yaw);
    return {
      key: `${key}.${k}`,
      cx: piece.x + dx, cy: baseY + h / 2, cz: piece.z + dz,
      sx: w, sy: h, sz: size.depthMeters,
      yawDegrees: yaw,
      color: look.color,
      opacity: opacity ?? look.opacity,
    };
  };

  if (def.kind === 'ramp' || def.kind === 'stairs') {
    // stepped boxes rising along local +v — the heightfield's own direction,
    // so what you see is the slope you walk
    const boxes: VisualBox[] = [];
    const steps = BUILD_UI.rampVisualSteps;
    for (let i = 0; i < steps; i += 1) {
      const v = (-size.depthMeters / 2) + ((i + 0.5) / steps) * size.depthMeters;
      const h = ((i + 1) / steps) * size.heightMeters;
      const { dx, dz } = localOffset(0, v, yaw);
      boxes.push({
        key: `${key}.s${i}`,
        cx: piece.x + dx, cy: piece.y + h / 2, cz: piece.z + dz,
        sx: size.widthMeters, sy: h, sz: size.depthMeters / steps,
        yawDegrees: yaw,
        color: look.color,
        opacity: look.opacity,
      });
    }
    return boxes;
  }

  const edit = piece.edit;
  if (edit !== undefined && GAME_BUILD.kinds.get(def.kind).edits === 'wall') {
    const meaning = GAME_BUILD.edits.wall[edit];
    if (meaning.portalKind !== 'none') {
      // the opening is OPEN — render the two jambs the collider keeps
      const opening = meaning.portalKind === 'vehicle'
        ? GAME_BUILD.placed.tuning.vehicleOpeningWidthMeters
        : GAME_BUILD.placed.tuning.walkOpeningWidthMeters;
      const jamb = (size.widthMeters - opening) / 2;
      if (jamb <= 0) return [];
      return [
        box('l', -(size.widthMeters - jamb) / 2, piece.y, jamb, size.heightMeters),
        box('r', (size.widthMeters - jamb) / 2, piece.y, jamb, size.heightMeters),
      ];
    }
    if (edit === 'halfHeight') {
      return [box('half', 0, piece.y, size.widthMeters, GAME_BUILD.placed.tuning.halfHeightTopMeters)];
    }
    const paneOpacity = SIGHTLINE_EDIT_OPACITY[edit];
    if (paneOpacity !== undefined) {
      return [box('pane', 0, piece.y, size.widthMeters, size.heightMeters, paneOpacity)];
    }
  }
  return [box('body', 0, piece.y, size.widthMeters, size.heightMeters)];
}

function VisualBoxMesh(props: { box: VisualBox; colorOverride?: string; opacityOverride?: number }) {
  const b = props.box;
  return (
    <Scene3D.Mesh
      geometry={Geometry.Box}
      params={{ width: 1, height: 1, depth: 1 }}
      scale={[b.sx, b.sy, b.sz]}
      rotation={[0, b.yawDegrees, 0]}
      position={[b.cx, b.cy, b.cz]}
      material={{ color: props.colorOverride ?? b.color, opacity: props.opacityOverride ?? b.opacity ?? 1 }}
    />
  );
}

// The standing pieces — memo'd so camera/walk frames don't re-diff the city.
const PlacedPieceMeshes = memo(function PlacedPieceMeshes(props: {
  pieces: readonly PlacedBuildPiece[];
  markedIds: ReadonlySet<string>;
  targetId: string | null;
}) {
  return (
    <>
      {props.pieces.flatMap((piece) =>
        pieceVisualBoxes(piece, piece.id).map((b) => (
          <VisualBoxMesh
            key={b.key}
            box={b}
            colorOverride={props.markedIds.has(piece.id) ? BUILD_UI.markColor : props.targetId === piece.id ? BUILD_UI.targetColor : undefined}
          />
        )))}
    </>
  );
});

// ── chips (route chrome) ─────────────────────────────────────────────────────

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

export function BuildRoute(props: { state: GameState; mapName: string; onExit: () => void }) {
  const worldGrid = useMemo(() => worldGridOf(props.state), [props.state]);

  // ── the builder's session on the WORLD channel (the user's V20 ruling) ────
  const build = useMemo(() => {
    try {
      const channel = editorChannel(worldStream);
      return { channel, session: editorSessions().open('/build', channel) as RouteSession<WorldEvent>, error: null as string | null };
    } catch (error: any) {
      return { channel: null, session: null, error: String(error?.message ?? error) };
    }
  }, []);
  useEffect(() => () => build.session?.close(), [build]);

  // The stream's materialized state IS the placed-piece truth; rev bumps
  // after each commit and the route re-reads — no second copy anywhere.
  const [piecesRev, setPiecesRev] = useState(0);
  const streamState: WorldStreamState | null = useMemo(
    () => (build.channel ? build.channel.state() : null),
    [build, piecesRev],
  );
  const pieces = streamState?.pieces ?? [];
  const piecesRef = useRef(pieces);
  piecesRef.current = pieces;

  // ── live tuning (P2 in-interface; defaults are the named tables) ──────────
  const [reachMeters, setReachMeters] = useState(SNAP_TUNING_DEFAULTS.reachMeters);
  const [ghostOpacity, setGhostOpacity] = useState<number>(BUILD_UI.ghostOpacity);
  const [marchStep, setMarchStep] = useState(SNAP_TUNING_DEFAULTS.groundMarchStepMeters);
  const [showTuning, setShowTuning] = useState(false);
  const snapTuning = useMemo(() => ({
    ...SNAP_TUNING_DEFAULTS,
    reachMeters,
    groundMarchStepMeters: marchStep,
  }), [reachMeters, marchStep]);
  const snapTuningRef = useRef(snapTuning);
  snapTuningRef.current = snapTuning;

  // ── the palette (registry-driven: the catalog is the source) ──────────────
  const kinds = GAME_BUILD.kinds.kinds;
  const prefabDefs = useMemo<BuildPrefabDef[]>(() => [
    ...GAME_BUILD.prefabs.ids.map((id) => GAME_BUILD.prefabs.get(id)),
    ...Object.values(streamState?.prefabs ?? {}),
  ], [streamState]);
  const [armed, setArmed] = useState<Armed>(() => {
    const first = GAME_BUILD.catalog.byKind(kinds[0])[0];
    return { type: 'piece', id: first.id };
  });
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
  const [ghostYaw, setGhostYaw] = useState(0);
  const ghostYawRef = useRef(0);

  // ── player + camera (the /test pattern, walk mode only) ───────────────────
  const [player, setPlayer] = useState(() => initialPlayer(props.state, worldGrid));
  const playerRef = useRef(player);
  playerRef.current = player;
  const lookRef = useRef({ yaw: props.state.player.yawDegrees, pitch: CAMERA.initialPitchDegrees });
  const keysRef = useRef<ReturnType<typeof GAME_INPUT.createKeyState> | null>(null);
  const dragRef = useRef<{ x: number; y: number; movedPixels: number } | null>(null);

  const sendCameraParams = (pose: { x: number; y: number; z: number }) => {
    const l = lookRef.current;
    GAME_NATIVE_CAMERA.setOrbit({
      target: [pose.x, pose.y + CAMERA.targetHeightMeters, pose.z],
      yaw: l.yaw,
      pitch: l.pitch,
      distance: CAMERA.distanceMeters,
      fov: CAMERA.fovDegrees,
    });
  };
  const sendCameraRef = useRef(sendCameraParams);
  sendCameraRef.current = sendCameraParams;

  useEffect(() => {
    sendCameraRef.current(playerRef.current);
    GAME_NATIVE_CAMERA.setMode('walk');
    const bound = GAME_NATIVE_CAMERA.bindFirst();
    if (!bound) console.warn('[build] native camera not engaged — host missing has-game-camera (rebuild)');
    return () => {
      GAME_NATIVE_CAMERA.disable();
    };
  }, []);

  useEffect(() => {
    const next = initialPlayer(props.state, worldGrid);
    playerRef.current = next;
    setPlayer(next);
    lookRef.current.yaw = props.state.player.yawDegrees;
    sendCameraRef.current(next);
  }, [props.state, worldGrid]);

  useEffect(() => {
    const keys = GAME_INPUT.createKeyState();
    keysRef.current = keys;
    return () => {
      keysRef.current = null;
      keys.dispose();
    };
  }, []);

  // ── colliders: the authored world + the placed pieces, both door-derived ──
  const worldColliders = useMemo(() => {
    const built = GAME_WORLD.collisionRects(worldGrid);
    if (built.dropped > 0) console.warn(`[build] world colliders past the host cap: ${built.dropped} dropped`);
    return built;
  }, [worldGrid]);
  const stepSolids = useMemo(() => {
    const placedSolids = GAME_BUILD.placed.colliders(pieces);
    const rects = [...worldColliders.rects, ...placedSolids.rects];
    const orientedRects = placedSolids.orientedRects;
    // host caps are wire facts — truncate loudly, never throw mid-frame
    if (rects.length > PHYSICS_LIMITS.rects) {
      console.warn(`[build] ${rects.length} rects past the host cap ${PHYSICS_LIMITS.rects} — newest dropped`);
      rects.length = PHYSICS_LIMITS.rects;
    }
    if (orientedRects.length > PHYSICS_LIMITS.orientedRects) {
      console.warn(`[build] ${orientedRects.length} oriented rects past the host cap ${PHYSICS_LIMITS.orientedRects}`);
      orientedRects.length = PHYSICS_LIMITS.orientedRects;
    }
    return { rects, orientedRects };
  }, [worldColliders, pieces]);

  // terrain heightfields + ramp/stairs slopes (slots continue after terrain)
  useEffect(() => {
    const baked = GAME_WORLD.registerHeightfields(worldGrid);
    if (baked.dropped > 0) console.warn(`[build] landforms past the heightfield slots: ${baked.dropped} not baked`);
    const ramps = GAME_BUILD.placed.ramps(pieces, baked.fields.length);
    let registered = 0;
    for (const field of ramps) {
      if (field.slot >= GAME_WORLD.heightfieldSlots) break;
      GAME_PHYSICS.registerHeightfield(field);
      registered += 1;
    }
    if (registered < ramps.length) console.warn(`[build] ${ramps.length - registered} ramp slopes past the heightfield slots`);
    return () => {
      GAME_PHYSICS.clearHeightfields();
    };
  }, [worldGrid, pieces]);

  // ── the figure (V2 kit, editor-preview render path) ───────────────────────
  const figure = useMemo(() => {
    const doc = GAME_FIGURE.generateFace(PLAYER_FIGURE_SEED);
    const parts = buildPartRender(doc, GAME_FIGURE.hedDepthGrid(doc), PLAYER_FIGURE_CART_KEY, PLAYER_FIGURE_SEED);
    return { doc, parts };
  }, []);
  const pose = player.moving ? 'walk' : 'stand';
  const gaitStep = Math.round(player.gaitPhase * GAIT.framesPerCycle) / GAIT.framesPerCycle;
  const rig = useMemo(() => GAME_FIGURE.buildRigFrame('neutral', pose, gaitStep), [pose, gaitStep]);
  const figureOffset = useMemo<[number, number, number]>(() => [player.x, player.y, player.z], [player.x, player.y, player.z]);

  // ── crosshair → snap target (recomputed in the frame loop, published only
  //    when the SNAPPED result changes — quantized values make that cheap) ───
  const [snapTarget, setSnapTarget] = useState<SnapTarget | null>(null);
  const snapTargetRef = useRef<SnapTarget | null>(null);
  const snapKeyRef = useRef('');

  const crosshairRay = (): PieceRay => {
    const p = playerRef.current;
    const l = lookRef.current;
    const solved = GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, {
      target: [p.x, p.y + CAMERA.targetHeightMeters, p.z],
      yaw: l.yaw,
      pitch: l.pitch,
      dist: CAMERA.distanceMeters,
      fov: CAMERA.fovDegrees,
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

  // ── one commit per interaction (the editors/sessions ruling) ──────────────
  const commit = (event: WorldEvent, label: string): boolean => {
    if (!build.session) return false;
    build.session.commit(event, label);
    setPiecesRev((r) => r + 1);
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
      console.warn(`[build] placement refused: ${problems.join('; ')}`);
      return;
    }
    commit({ kind: 'piecePlaced', placement }, `placed ${def.label} @ ${at}`);
  };
  const placeRef = useRef(place);
  placeRef.current = place;

  // ── prefab capture (P marks → name → save) ────────────────────────────────
  const [markedIds, setMarkedIds] = useState<ReadonlySet<string>>(() => new Set<string>());
  const markedRef = useRef(markedIds);
  markedRef.current = markedIds;
  const [prefabName, setPrefabName] = useState('');

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
      console.warn(`[build] prefab refused: ${problems.join('; ')}`);
      return;
    }
    commit({ kind: 'prefabDefined', def }, `prefab ${label} (${composition.length} pieces)`);
    setMarkedIds(new Set());
    setPrefabName('');
    setArmed({ type: 'prefab', id: def.id }); // clone → stamp, one motion
  };

  // ── the builder keys (route chrome; typing-gated) ──────────────────────────
  useEffect(() => {
    const off = GAME_INPUT.onKeyDown((event) => {
      if (GAME_INPUT.isTextEditing()) return;
      const key = String(event?.key ?? '').toLowerCase();
      if (key >= '1' && key <= '9') {
        const index = Number(key) - 1;
        if (index < kinds.length) armKind(kinds[index]);
        return;
      }
      if (key === '0') {
        armKind('prefab');
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
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── the frame loop (the /test movement pattern + snap refresh) ────────────
  useEffect(() => {
    let alive = true;
    let handle: ReturnType<typeof GAME_LOOP.scheduleFrame> | null = null;
    let last = GAME_LOOP.now();
    const loop = () => {
      if (!alive) return;
      const now = GAME_LOOP.now();
      const dt = clamp((now - last) / 1000, FRAME.minDtSeconds, FRAME.maxDtSeconds);
      last = now;
      const keys = keysRef.current;
      const typing = GAME_INPUT.isTextEditing();
      const axes = keys && !typing ? GAME_INPUT.moveAxes(keys) : { forward: 0, strafe: 0 };
      const running = keys != null && !typing && GAME_INPUT.actionDown(keys, 'run');
      const jumpDown = keys != null && !typing && GAME_INPUT.actionDown(keys, 'jump');
      const intent = GAME_INPUT.moveIntent(axes, lookRef.current.yaw * DEG);
      const moving = intent.x !== 0 || intent.z !== 0;
      const prev = playerRef.current;
      const desiredYaw = moving ? normalizeYawDegrees(Math.atan2(-intent.x, -intent.z) / DEG) : prev.yaw;
      const footing = GAME_WORLD.footingKindAtWorldPosition(worldGrid, { x: prev.x, y: prev.y, z: prev.z });
      const surfaceProfile = footing ? GAME_KINDS.tiles.get(footing).surface : FALLBACK_SURFACE;
      const baseSpeed = running ? props.state.player.runSpeedMetersPerSecond : props.state.player.walkSpeedMetersPerSecond;
      const speed = baseSpeed * (running ? surfaceProfile.runSpeedMultiplier : surfaceProfile.walkSpeedMultiplier);
      const stepped = GAME_PHYSICS.hostReady()
        ? GAME_PHYSICS.step({
            dtSeconds: dt,
            intentX: intent.x,
            intentZ: intent.z,
            speedMetersPerSecond: speed,
            jumpDown,
            player: {
              position: { x: prev.x, y: prev.y, z: prev.z },
              velocity: { x: prev.vx, y: prev.vy, z: prev.vz },
              yawDegrees: prev.yaw,
            },
            surface: {
              accelerationMultiplier: surfaceProfile.accelerationMultiplier,
              friction: surfaceProfile.friction,
              restitution: surfaceProfile.restitution,
            },
            tuning: props.state.config.physics,
            rects: stepSolids.rects,
            orientedRects: stepSolids.orientedRects,
          })
        : null;
      if (stepped) {
        const p = stepped.player;
        const atRest = !moving && !jumpDown && p.grounded && prev.grounded && !prev.moving && !prev.running
          && desiredYaw === prev.yaw
          && Math.abs(p.position.x - prev.x) < IDLE_REST_EPSILON
          && Math.abs(p.position.y - prev.y) < IDLE_REST_EPSILON
          && Math.abs(p.position.z - prev.z) < IDLE_REST_EPSILON;
        if (!atRest) {
          const next: PlayerPose = {
            x: p.position.x, y: p.position.y, z: p.position.z,
            vx: p.velocity.x, vy: p.velocity.y, vz: p.velocity.z,
            grounded: p.grounded,
            yaw: desiredYaw,
            moving,
            running: moving && running,
            gaitPhase: moving ? prev.gaitPhase + dt * (running ? GAIT.runCyclesPerSecond : GAIT.walkCyclesPerSecond) : prev.gaitPhase,
          };
          playerRef.current = next;
          setPlayer(next);
          sendCameraRef.current(next);
        }
      } else if (moving) {
        // honest fallback when host physics is absent: kinematic + ground pin
        const x = prev.x + intent.x * speed * dt;
        const z = prev.z + intent.z * speed * dt;
        const next: PlayerPose = {
          ...prev,
          x,
          y: groundColumnTop(worldGrid, x, z),
          z,
          yaw: desiredYaw,
          moving: true,
          running,
          gaitPhase: prev.gaitPhase + dt * (running ? GAIT.runCyclesPerSecond : GAIT.walkCyclesPerSecond),
        };
        playerRef.current = next;
        setPlayer(next);
        sendCameraRef.current(next);
      } else if (prev.moving || prev.running || prev.yaw !== desiredYaw) {
        const next = { ...prev, vx: 0, vz: 0, moving: false, running: false, yaw: desiredYaw };
        playerRef.current = next;
        setPlayer(next);
      }
      // the builder's eye: re-resolve the crosshair every frame; publishes
      // React state only when the SNAPPED target actually changed
      refreshSnapRef.current();
      handle = GAME_LOOP.scheduleFrame(loop);
    };
    handle = GAME_LOOP.scheduleFrame(loop);
    return () => {
      alive = false;
      if (handle != null) GAME_LOOP.cancelFrame(handle);
    };
  }, [props.state, worldGrid, stepSolids]);

  // ── drag-orbit + click-places (slop separates the two) ────────────────────
  const onDown = (e: any) => { dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0), movedPixels: 0 }; };
  const onMove = (e: any) => {
    const d = dragRef.current;
    if (!d) return;
    const x = Number(e?.x ?? 0), y = Number(e?.y ?? 0);
    const dx = x - d.x, dy = y - d.y;
    d.x = x; d.y = y;
    d.movedPixels += Math.abs(dx) + Math.abs(dy);
    const l = lookRef.current;
    const nextYaw = l.yaw - dx * CAMERA.yawDegreesPerPixel;
    const nextPitch = clamp(l.pitch - dy * CAMERA.pitchDegreesPerPixel, CAMERA.minPitchDegrees, CAMERA.maxPitchDegrees);
    GAME_NATIVE_CAMERA.setInputDeltas(nextYaw - l.yaw, nextPitch - l.pitch);
    l.yaw = nextYaw;
    l.pitch = nextPitch;
  };
  const onUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d && d.movedPixels <= BUILD_UI.clickSlopPixels) placeRef.current();
  };

  // ── ghost boxes for the armed selection at the snap target ────────────────
  const ghostBoxes = useMemo<VisualBox[]>(() => {
    if (!snapTarget) return [];
    const p = snapTarget.placement;
    if (armedPrefab) {
      return GAME_BUILD.placed
        .stamp(armedPrefab, { x: p.x, y: p.y, z: p.z }, p.yawDegrees)
        .flatMap((piece, index) => pieceVisualBoxes(piece, `ghost.${index}`));
    }
    if (armedDef) {
      return pieceVisualBoxes({ pieceId: armedDef.id, x: p.x, y: p.y, z: p.z, yawDegrees: p.yawDegrees }, 'ghost');
    }
    return [];
  }, [snapTarget, armedDef, armedPrefab]);

  // session history strip: the labeled commits prove one-interaction-one-commit
  const sessionCommits = useMemo(() => {
    if (!build.session) return [];
    const record = editorSessions().state().sessions[build.session.id];
    return record ? record.commits : [];
  }, [build, piecesRev]);

  const sceneState = {
    ...props.state,
    player: {
      ...props.state.player,
      position: { x: player.x, y: player.y, z: player.z } as Vec3,
      yawDegrees: player.yaw,
    },
  };
  const [bootCam] = useState(() =>
    GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, {
      target: [playerRef.current.x, playerRef.current.y + CAMERA.targetHeightMeters, playerRef.current.z],
      yaw: lookRef.current.yaw,
      pitch: lookRef.current.pitch,
      dist: CAMERA.distanceMeters,
      fov: CAMERA.fovDegrees,
    }));

  const armedLabel = armedPrefab ? `${armedPrefab.label} (prefab)` : armedDef ? armedDef.label : '—';
  const targetPiece = snapTarget?.targetPieceId ? pieces.find((p) => p.id === snapTarget.targetPieceId) ?? null : null;

  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#080d16' }}>
      {/* GAP(W-2): world surface captures await the world render lane */}
      <TileSurfaceCaptures regions={sceneState.world.surfaceRegions} />
      <RoadSurfaceCaptures roads={sceneState.world.roads} />
      <RoadJunctionCaptures junctions={sceneState.world.junctions} />
      <LandformSurfaceCaptures landforms={sceneState.world.landforms ?? []} />
      <BuildingSurfaceCaptures buildings={sceneState.world.buildings} perception={sceneState.player.perception} />
      <PropSurfaceCaptures props={sceneState.world.props} />
      <WorldPartCaptures buildings={sceneState.world.buildings} props={sceneState.world.props} perception={sceneState.player.perception} />
      <DriveInScreenCaptures buildings={sceneState.world.buildings} />
      <CharacterCaptures
        headTexKey={figure.parts.head.texKey}
        skinTexKey={figure.parts.torso.texKey}
        skin={figure.doc.skin}
        layers={figure.doc.layers}
      />
      {/* GAP(W-3): game sky background awaits a captured home */}
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={hmscSkyBackgroundColor(sceneState.config.sky)} showGrid={false} showAxes={false}>
        {/* STATIC boot frame — the V23 controller owns these fields per frame once bound */}
        <Scene3D.Camera position={bootCam.pos} target={bootCam.target} fov={bootCam.fov} far={sceneState.config.view.drawRadiusMeters} />
        <Scene3D.Fog enabled={false} />
        <WorldStatics world={sceneState.world} skyConfig={sceneState.config.sky} />
        {/* the standing pieces — the world stream's materialized truth */}
        <PlacedPieceMeshes pieces={pieces} markedIds={markedIds} targetId={snapTarget?.targetPieceId ?? null} />
        {/* the snap indicator + the ghost */}
        {snapTarget && (
          <Scene3D.Mesh
            geometry={Geometry.Box}
            params={{ width: 1, height: 1, depth: 1 }}
            scale={[BUILD_UI.indicatorSizeMeters, BUILD_UI.indicatorSizeMeters, BUILD_UI.indicatorSizeMeters]}
            position={[snapTarget.hit.x, snapTarget.hit.y, snapTarget.hit.z]}
            material={{ color: BUILD_UI.ghostColor }}
          />
        )}
        {ghostBoxes.map((b) => (
          <VisualBoxMesh key={b.key} box={b} colorOverride={BUILD_UI.ghostColor} opacityOverride={ghostOpacity} />
        ))}
        <PlayerMeshes rig={rig} parts={figure.parts} yawDeg={player.yaw} offset={figureOffset} />
      </Scene3D>

      {/* crosshair — centered by the wrapper (absolute left/top take no %),
          BEFORE the gesture Pressable so the center click still places */}
      <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
        <Box style={{ width: 2, height: 14, backgroundColor: '#e0f2fe88' }} />
        <Box style={{ width: 14, height: 2, backgroundColor: '#e0f2fe88', marginTop: -8 }} />
      </Box>

      <Pressable onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#00000001' }} />

      {/* top-left: exit + status */}
      <Box style={{ position: 'absolute', left: 12, top: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable onPress={props.onExit} style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 6, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f1a2e' }}>
          <Text fontSize={11} color="#cbd5e1" style={{ fontWeight: 700 }}>Back</Text>
        </Pressable>
        <Text fontSize={10} color="#64748b" style={{ fontFamily: 'monospace' }}>
          {`${props.mapName} · BUILD · WASD move · Space jump · drag look · click place · R rotate · E edit · X remove · P mark · 1-9/0 category · [ ] variant`}
        </Text>
      </Box>
      {build.error != null && (
        <Box style={{ position: 'absolute', left: 12, top: 40, backgroundColor: '#7f1d1dcc', borderRadius: 6, paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4 }}>
          <Text fontSize={10} color="#fecaca" style={{ fontFamily: 'monospace' }}>{`persistence host missing — placements disabled (${build.error})`}</Text>
        </Box>
      )}

      {/* top-right: session trace (one interaction = one labeled commit) + tuning */}
      <Box style={{ position: 'absolute', right: 12, top: 12, alignItems: 'flex-end', gap: 4 }}>
        <Box style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <Text fontSize={10} color="#94a3b8" style={{ fontFamily: 'monospace' }}>
            {`${sessionCommits.length} commit${sessionCommits.length === 1 ? '' : 's'} · ${pieces.length} piece${pieces.length === 1 ? '' : 's'}`}
          </Text>
          <Chip label="tuning" on={showTuning} onPress={() => setShowTuning((s) => !s)} />
        </Box>
        {sessionCommits.slice(-3).reverse().map((c) => (
          <Text key={c.seq} fontSize={9} color="#475569" style={{ fontFamily: 'monospace' }}>{`#${c.seq} ${c.label}`}</Text>
        ))}
        {showTuning && (
          <Box style={{ backgroundColor: BUILD_UI.panelBg, borderWidth: 1, borderColor: '#27364a', borderRadius: 8, padding: 10, gap: 6, width: 240 }}>
            <GAME_CHROME.Knob label="build reach (m)" value={reachMeters} spec={{ min: 4, max: 30, step: 1, precision: 0 }} onChange={setReachMeters} />
            <GAME_CHROME.Knob label="ghost opacity" value={ghostOpacity} spec={{ min: 0.1, max: 0.9, step: 0.05, precision: 2 }} onChange={setGhostOpacity} />
            <GAME_CHROME.Knob label="ground march (m)" value={marchStep} spec={{ min: 0.1, max: 1, step: 0.05, precision: 2 }} onChange={setMarchStep} />
          </Box>
        )}
      </Box>

      {/* prefab capture panel — appears while pieces are marked */}
      {markedIds.size > 0 && (
        <Box style={{ position: 'absolute', right: 12, bottom: 86, backgroundColor: BUILD_UI.panelBg, borderWidth: 1, borderColor: '#facc15', borderRadius: 8, padding: 10, gap: 6, width: 240 }}>
          <Text fontSize={10} color="#fde68a" style={{ fontWeight: 700 }}>{`${markedIds.size} piece${markedIds.size === 1 ? '' : 's'} marked (P toggles)`}</Text>
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

      {/* bottom palette — the registry IS the list (kinds + catalog + prefabs) */}
      <Box style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: BUILD_UI.paletteBg, borderTopWidth: 1, borderTopColor: '#1f2937', padding: 8, gap: 6 }}>
        <Box style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
          {kinds.map((kind, index) => (
            <Chip
              key={kind}
              label={`${index < 9 ? `${index + 1} ` : ''}${GAME_BUILD.kinds.get(kind).label}`}
              on={armedKind === kind}
              onPress={() => armKind(kind)}
            />
          ))}
          <Chip label="0 Prefabs" on={armedKind === 'prefab'} onPress={() => armKind('prefab')} />
        </Box>
        <Box style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          {armedKind === 'prefab'
            ? prefabDefs.map((def) => (
                <Chip key={def.id} label={def.label} on={armed.type === 'prefab' && armed.id === def.id} onPress={() => setArmed({ type: 'prefab', id: def.id })} />
              ))
            : entriesOfArmedKind.map((def) => (
                <Chip key={def.id} label={`${def.label} · ${def.theme}`} on={armed.type === 'piece' && armed.id === def.id} onPress={() => setArmed({ type: 'piece', id: def.id })} />
              ))}
          <Text fontSize={10} color="#64748b" style={{ fontFamily: 'monospace', marginLeft: 8 }}>
            {`armed: ${armedLabel} · yaw ${ghostYaw}° · ${snapTarget ? `${snapTarget.surface}${targetPiece ? ` → ${GAME_BUILD.catalog.get(targetPiece.pieceId).label}${targetPiece.edit ? ` [${targetPiece.edit}]` : ''}` : ''}` : 'no target'}`}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
