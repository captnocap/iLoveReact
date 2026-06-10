// Embodied.tsx — THE EMBODIED SUBSTRATE (SUBSTRATE-0605): the drop-in player
// scene shared by every embodied route (/test, /build). Extracted FROM
// TestRoute — the USER-VERDICT-hardened lineage (V23 node-bound native camera,
// the smooth continuous gait, host physics integration) — so the drop-in
// player exists exactly ONCE. Routes keep only their mode layer (test:
// console/jump-aim playground; build: palette/ghost/placement) and consume
// this surface: one hook + three components.
//
//   useEmbodiedPlayer(options)  world grid + colliders + heightfields, key
//                               transport, the frame loop (host physics step,
//                               camera-relative WASD, idle-rest discipline),
//                               the V23 native camera bind, captured-mouse
//                               look, the V2 figure + continuous-gait rig.
//   <EmbodiedCaptures>          the world render-capture set + figure captures.
//   <EmbodiedScene>             Scene3D + bound camera + WorldStatics + the
//                               player figure; route 3D content as children.
//   <EmbodiedMouseSurface>      the full-area click-to-capture Pressable.
//
// MOUSE CAPTURE (USER VERDICT, SUBSTRATE-0605 addendum 4: "make it consume my
// mouse until esc or something, cuz clicking to drag the camera around also
// ends up placing the build"): entering an embodied route CONSUMES the mouse
// — the camera follows raw relative motion with no button held (the door's
// __mouse_capture/__mouse_delta wire, GAME_INPUT.setPointerCapture/
// readPointerDelta). Esc releases the mouse back to the UI; clicking the
// viewport re-captures. While captured a left-click is ALWAYS the mode
// layer's intent (onTap — build: place); while released clicks hit UI only.
// No drag heuristics anywhere — capture kills the drag-place collision.
//
// Captured systems arrive through the @game door; the items still reaching
// into cart/hmsc/** are marked GAP(W-1|W-2|W-3) and move behind the world
// lanes when those captures land — never half-captured here.
//
//   GAME_INPUT    keys (blur-clearing snapshot), WASD contract, camera-relative
//                 moveIntent (the V7 cart-side duty: ship a direction vector),
//                 typing gate.
//   GAME_NATIVE_CAMERA  V23 — THE CAMERA IS NOT JAVASCRIPT: the host
//                 controller (framework/game/camera.zig) owns every frame;
//                 JS sends rig params/mode/drag deltas ON CHANGE only. Both
//                 ruled modes (Q3/Q3b): Orbit walk + RMB ADS Aim (the aim
//                 layer engages only for routes that opt in). GAME_CAMERA
//                 remains only for the boot frame + the Aim pitch limits.
//   GAME_LOOP     frame transport (rAF probe) + monotonic now.
//   GAME_FIGURE   the V2 kit player (seeded face, dressed rig); render via the
//                 editor-preview path @game/figure/render (V2-AMENDED: per-frame
//                 JS rig eval is editor/lab-only; the compiled game uses the bake).
//   GAME_PHYSICS  the host step owns integration: movement blend, gravity,
//                 jump arc, ground/step resolution.
//   GAME_WORLD    W-1 CLOSED — colliders (collisionRects), terrain heightfields
//                 (registerHeightfields), footing→surface feel, ground heights.
//
// GAP(W-2) world render: WorldStatics + the surface-capture mounts.
// GAP(W-3) game sky: hmsc config.sky has no captured home (chrome's LabSky is
//   the lab environment, a different shape).
// GAP(buildings) building/prop collision + interiors: its own NOT_YET lane.

import { memo, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Pressable, Scene3D } from '@reactjit/primitives';
import { GAME_CAMERA, GAME_FIGURE, GAME_INPUT, GAME_KINDS, GAME_LOOP, GAME_NATIVE_CAMERA, GAME_PHYSICS, GAME_TELEMETRY, GAME_WORLD, PHYSICS_LIMITS } from '@game';
import type { CollisionRect, OrientedCollisionRect, WorldGridState } from '@game';
import { CharacterCaptures, FigureMeshes, buildPartRender } from '@game/figure/render';
import { LIVE_FLOOR_PROBE, liveFloorRecoveryDecision } from './embodiedLiveFloor';
import type { GameState, Vec3 } from '../hmsc/design'; // GAP: the editor GameState type retires when hmsc becomes compile/'s output (V15)
import { WorldStatics } from '../hmsc/render3d/GameWorld3D'; // GAP(W-2) awaiting world render
import { TileSurfaceCaptures } from '../hmsc/render3d/tileSurface'; // GAP(W-2)
import { RoadSurfaceCaptures } from '../hmsc/render3d/Road'; // GAP(W-2)
import { RoadJunctionCaptures } from '../hmsc/render3d/RoadJunctions'; // GAP(W-2)
import { LandformSurfaceCaptures } from '../hmsc/render3d/Landform'; // GAP(W-2)
import { PropSurfaceCaptures } from '../hmsc/render3d/PropCaptures'; // GAP(W-2)
import { hmscSkyBackgroundColor } from '../hmsc/render3d/sky'; // GAP(W-3) awaiting game sky

const DEG = Math.PI / 180;

// Substrate presentation data (P2: named values, no inline numbers). The
// camera block reproduces the pre-rewrite boot frame exactly in Orbit-rig
// terms (REWIRE table #21); gait cadence is the V2 figure's walk cycle —
// promote to the figure tuning table when the P2 tuning surface lands.
// PLAYER_CAMERA is exported: build's crosshair ray must solve with the SAME
// values the renderer-consumed camera was parameterized with.
// NOT `as const`: every leaf is a P2 tunable (registered as 'play-camera-feel'
// in PlayRoute) so the camera's whole feel — how far back it sits, fov, look
// sensitivity, pitch limits — is dialable live from the settings menu. The
// registry writes THROUGH this object; desiredCamera()/applyLook read it fresh
// each frame, and a knob edit re-sends the rig params to the host controller.
export const PLAYER_CAMERA = {
  distanceMeters: 7.65,
  initialPitchDegrees: 17.8,
  minPitchDegrees: -10,
  maxPitchDegrees: 62,
  targetHeightMeters: 1.45,
  fovDegrees: 52,
  yawDegreesPerPixel: 0.28,
  pitchDegreesPerPixel: 0.22,
};
const GAIT = {
  walkCyclesPerSecond: 1.6,
  runCyclesPerSecond: 2.3,
} as const;
const FRAME = { minDtSeconds: 0.001, maxDtSeconds: 0.05 } as const;
const MOVEMENT_INTENT_DEADZONE = 0.001;
const NOCLIP_MIN_HEIGHT_METERS = 0;
const PLAYER_FIGURE_SEED = 1;
const HEIGHTFIELD_OWNER_KEY = '__hmsc_embodied_heightfield_owner';

// memo() so the 57-mesh figure subtree only re-diffs when rig/offset/yaw
// actually change — an idle camera drag must not pay the figure.
const PlayerMeshes = memo(FigureMeshes);

export type PlayerPose = {
  x: number;
  y: number;
  z: number;
  /** carried velocity — the host step integrates it (V7), the route just stores it */
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  yaw: number;
  moving: boolean;
  running: boolean;
  /** walk-cycle phase in cycles (buildSkeleton's gait clock) */
  gaitPhase: number;
};

// Surface feel under the player: the door's footing resolution
// (GAME_WORLD.footingKindAtWorldPosition — water/placed-cell/landform/region,
// the reference's layer order) into the captured kind table; the no-tile
// fallback is the game's observed one (hostPhysics: `?? 'road'`).
const FALLBACK_SURFACE = GAME_KINDS.tiles.get('road').surface;

// Same epsilon discipline as the game's drive loop (hostPhysics): a resting
// host step must not publish a fresh pose object every frame — that is the
// idle re-render storm. Under the host's resting jitter and velocity deadzone.
const IDLE_REST_EPSILON = 1e-4;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function claimHeightfieldOwner(): number {
  const g = globalThis as any;
  const next = (typeof g[HEIGHTFIELD_OWNER_KEY] === 'number' ? g[HEIGHTFIELD_OWNER_KEY] : 0) + 1;
  g[HEIGHTFIELD_OWNER_KEY] = next;
  return next;
}

function currentHeightfieldOwner(): number {
  const current = (globalThis as any)[HEIGHTFIELD_OWNER_KEY];
  return typeof current === 'number' ? current : 0;
}

export function normalizeYawDegrees(yawDegrees: number): number {
  return ((yawDegrees % 360) + 360) % 360;
}

function orbitPitchToAimPitch(orbitPitchDegrees: number): number {
  return GAME_CAMERA.orientation.orbitPitchToAimPitch(orbitPitchDegrees);
}

function aimPitchToOrbitPitch(aimPitchDegrees: number): number {
  return GAME_CAMERA.orientation.aimPitchToOrbitPitch(aimPitchDegrees);
}

function aimPitchLimitsInOrbitSpace(): { min: number; max: number } {
  const minAim = GAME_CAMERA.rigs.Aim.defaults.minPitch as number;
  const maxAim = GAME_CAMERA.rigs.Aim.defaults.maxPitch as number;
  return { min: aimPitchToOrbitPitch(maxAim), max: aimPitchToOrbitPitch(minAim) };
}

function figureYawForCameraYaw(cameraYawDegrees: number): number {
  return GAME_CAMERA.orientation.figureYawForCameraYaw(cameraYawDegrees);
}

// The authored GameState's world slice IS the captured world-grid shape
// (the editor lowers paint/placements into these exact records) — this view
// is what every GAME_WORLD call takes. W-1 CLOSED: colliders, ground heights,
// and footing all flow from the door now. Buildings/props collision stays
// with its own lane ('buildings + interiors' in NOT_YET_CAPTURED).
export function worldGridOf(state: GameState): WorldGridState {
  return {
    cellSizeMeters: state.world.cellSizeMeters,
    surfaceRegions: state.world.surfaceRegions as unknown as WorldGridState['surfaceRegions'],
    placedCells: state.world.placedCells as unknown as WorldGridState['placedCells'],
    landforms: (state.world.landforms ?? []) as unknown as WorldGridState['landforms'],
  };
}

// Ground column: the highest standable top at (x, z) regardless of the
// player's current y — region tops + landform surface, all door math. (The
// door's groundTopAtWorldPosition is step-gated from a KNOWN y; spawning and
// snap targeting have none, so the column scan stays glue over door functions.)
export function groundColumnTop(world: WorldGridState, x: number, z: number): number {
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

/** Mode-layer additions to the embodied world (build: the placed pieces).
 *  Memoize per source state — identity drives collider/heightfield re-sync. */
export type EmbodiedWorldExtras = {
  /** extra solids merged after the world's (host caps enforced loudly here) */
  solids?: { rects: CollisionRect[]; orientedRects: OrientedCollisionRect[] };
  /** register extra heightfields after the world's; receives the world bake
   *  so slots continue where terrain stopped */
  registerHeightfields?: (worldBake: ReturnType<typeof GAME_WORLD.registerHeightfields>) => void;
};

export type EmbodiedOptions = {
  state: GameState;
  /** per-route figure texture namespace (e.g. 'hmscint.test.player') */
  figureCartKey: string;
  /** warn prefix, e.g. '[test]' */
  logTag: string;
  /** RMB ADS Aim (Q3/Q3b) — the jump-aim playground opts in; build stays walk-only */
  aim?: boolean;
  /** extra typing gate beyond GAME_INPUT.isTextEditing (test: the open console) */
  isTyping?: () => boolean;
  /** live speed source (test: the console ctx so gv_speed drives the route);
   *  default reads the authored state.player */
  speeds?: () => { walkSpeedMetersPerSecond: number; runSpeedMetersPerSecond: number; noclip?: boolean };
  /** optional live physics tuning override (build: floor-edge dial) */
  physicsTuning?: () => GameState['config']['physics'] & { walkableRectSidePushGraceMeters?: number };
  worldExtras?: EmbodiedWorldExtras;
  /** runs once per frame after the movement step (build: snap re-resolve) */
  onFrame?: () => void;
  /** PLAYERJIT-0606 witness: route-gated straight-walk frame table. */
  playerJitProbe?: boolean;
  /** a left-click while the mouse is CAPTURED (build: place) — always
   *  intentional; capture means a click is never a camera gesture */
  onTap?: () => void;
};

export type Embodied = {
  worldGrid: WorldGridState;
  player: PlayerPose;
  playerRef: RefObject<PlayerPose>;
  /** the JS yaw/pitch SHADOW of the host camera (V23) — read-only for mode layers */
  lookRef: RefObject<{ yaw: number; pitch: number }>;
  pointerWire: ReturnType<typeof GAME_INPUT.availability>;
  figure: { doc: ReturnType<typeof GAME_FIGURE.generateFace>; parts: ReturnType<typeof buildPartRender> };
  rig: ReturnType<typeof GAME_FIGURE.buildRigFrame>;
  pose: 'walk' | 'stand';
  figureOffset: [number, number, number];
  /** the authored state with the live player pose folded in — what the scene renders */
  sceneState: GameState;
  playerJitRenderRef: RefObject<PlayerJitRenderedFrame>;
  cameraRef: RefObject<any>;
  bootCam: ReturnType<typeof GAME_CAMERA.solve>;
  /** is the mouse currently consumed (relative-mode look)? Esc releases. */
  mouseCaptured: boolean;
  /** consume the mouse (route entry does this; the viewport click re-does it) */
  captureMouse: () => void;
  /** hand the mouse back to the UI (Esc does this) */
  releaseMouse: () => void;
  /** adopt an externally-authored pose (console teleport) — the camera follows */
  adoptPose: (next: PlayerPose) => void;
  /** route-owned camera constraints still pass through the substrate controller. */
  setCameraDistanceConstraint: (distanceMeters: number, minDistanceMeters: number, smoothingPerSecond: number) => void;
  /** The ACTIVE rig's natural (un-occluded) eye + the player-side pivot the eye
   *  sits back from, plus that rig's base distance. Walk = Orbit, ADS = Aim. The
   *  camera-collision spring-arm casts pivot→eye against walls, so it must use
   *  whichever rig is live — querying the orbit eye while aiming is why the aim
   *  camera clipped walls. */
  desiredCamera: () => { eye: Vec3; pivot: Vec3; baseDistance: number; aiming: boolean };
  /** Re-push the active rig's params (distance/fov/target) to the host controller.
   *  Routes call this when a 'play-camera-feel' tunable changes so a knob edit
   *  lands live — normal play sends params on pose change only. */
  resendCameraParams: () => void;
  /** back to the authored spawn (the Drop-in button) */
  resetPlayer: () => void;
};

type PlayerJitRenderedFrame = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pose: 'walk' | 'stand';
  gaitPhase: number;
};

export type EmbodiedCameraSample = { x: number | null; y: number | null; z: number | null; nodeId: number; source: string };

type PlayerJitFrame = {
  frame: number;
  tMs: number;
  dtMs: number;
  input: {
    axesForward: number;
    axesStrafe: number;
    intentX: number;
    intentZ: number;
    moving: boolean;
    running: boolean;
    jump: boolean;
    crouch: boolean;
    noclip: boolean;
  };
  rendered: PlayerJitRenderedFrame;
  physics: { x: number; y: number; z: number; dt: number; hostUs: number };
  camera: EmbodiedCameraSample;
  animation: { pose: 'walk' | 'stand'; gaitPhase: number };
  correction: {
    kind: 'none' | 'noclip-bypass' | 'live-floor-recovery' | 'host-step' | 'js-fallback' | 'idle-stop';
    reason?: string;
    registered?: boolean;
    fromY?: number;
    toY?: number;
  };
};

function numberField(obj: any, keys: string[]): number | null {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function vectorField(obj: any, keys: string[]): [number, number, number] | null {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of keys) {
    const value = obj[key];
    if (Array.isArray(value) && value.length >= 3) {
      const x = Number(value[0]), y = Number(value[1]), z = Number(value[2]);
      if ([x, y, z].every(Number.isFinite)) return [x, y, z];
    }
  }
  return null;
}

function parseHostJson(raw: unknown): any {
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return raw && typeof raw === 'object' ? raw : null;
}

export function readEmbodiedCameraNode(camera: any): EmbodiedCameraSample {
  const nodeId = Number(camera?.id ?? 0);
  if (!nodeId) return { x: null, y: null, z: null, nodeId: 0, source: 'no-node-id' };
  const host = globalThis as any;
  const raw = typeof host.__tel_node === 'function' ? parseHostJson(host.__tel_node(nodeId)) : null;
  const style = raw?.style ?? raw?.resolved_style ?? raw?.node?.style ?? raw;
  const pos = vectorField(style, ['position', 'pos', 'camera_position', 'cameraPosition'])
    ?? vectorField(raw, ['position', 'pos', 'camera_position', 'cameraPosition']);
  if (pos) return { x: pos[0], y: pos[1], z: pos[2], nodeId, source: 'tel_node.vector' };
  const x = numberField(style, ['x', 'camera_x', 'cameraX', 'position_x', 'pos_x']);
  const y = numberField(style, ['y', 'camera_y', 'cameraY', 'position_y', 'pos_y']);
  const z = numberField(style, ['z', 'camera_z', 'cameraZ', 'position_z', 'pos_z']);
  if (x != null && y != null && z != null) return { x, y, z, nodeId, source: 'tel_node.scalars' };
  return { x: null, y: null, z: null, nodeId, source: raw ? `tel_node.keys:${Object.keys(raw).slice(0, 10).join(',')}` : 'tel_node.unavailable' };
}

function writePlayerJitWitness(frames: PlayerJitFrame[]): void {
  const host = globalThis as any;
  if (typeof host.__fs_write !== 'function') return;
  const lines = frames.map((frame) => JSON.stringify(frame)).join('\n') + '\n';
  host.__fs_write('/tmp/playerjit-0606-frames.jsonl', lines);
}

export function useEmbodiedPlayer(options: EmbodiedOptions): Embodied {
  const { state, worldExtras } = options;
  // Mode-layer callbacks are read through this ref at call time (the latest-ref
  // idiom both routes already live by) — the frame loop never needs them as deps.
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const liveFloorProbeRef = useRef({ worldPrinted: false, recoveries: 0 });
  const registerHeightfieldsRef = useRef<(reason: string) => void>(() => undefined);

  // W-1 CLOSED: the door's view over the authored world — every GAME_WORLD
  // call (colliders, heightfields, footing, ground) takes this. Memoized per
  // authored state; the world is static while playing.
  const worldGrid = useMemo(() => worldGridOf(state), [state]);
  // The flat solid bands of the captured layers (regions + placed cells —
  // blocking tiles like walls now BLOCK). Buildings/props stay with their lane.
  const worldColliders = useMemo(() => {
    const built = GAME_WORLD.collisionRects(worldGrid);
    if (built.dropped > 0) console.warn(`${options.logTag} world colliders past the host cap: ${built.dropped} dropped`);
    return built;
  }, [worldGrid]);
  const worldHeightfields = useMemo(() => GAME_WORLD.heightfields(worldGrid), [worldGrid]);
  // The world's solids + the mode layer's (build: placed pieces) — host caps
  // are wire facts: truncate loudly, never throw mid-frame.
  const solids = useMemo(() => {
    const extra = worldExtras?.solids;
    if (!extra) return { rects: worldColliders.rects, orientedRects: [] as OrientedCollisionRect[] };
    const rects = [...worldColliders.rects, ...extra.rects];
    const orientedRects = [...extra.orientedRects];
    if (rects.length > PHYSICS_LIMITS.rects) {
      console.warn(`${options.logTag} ${rects.length} rects past the host cap ${PHYSICS_LIMITS.rects} — newest dropped`);
      rects.length = PHYSICS_LIMITS.rects;
    }
    if (orientedRects.length > PHYSICS_LIMITS.orientedRects) {
      console.warn(`${options.logTag} ${orientedRects.length} oriented rects past the host cap ${PHYSICS_LIMITS.orientedRects}`);
      orientedRects.length = PHYSICS_LIMITS.orientedRects;
    }
    return { rects, orientedRects };
  }, [worldColliders, worldExtras]);
  // Terrain heightfields → host collider slots (see-it == walk-it: painted
  // hills are walkable, slopes resolve host-side), then the mode layer's
  // (build: ramp/stairs slopes continue where terrain stopped). No-op until
  // the host carries has-game-physics; cleared on unmount so routes start clean.
  useEffect(() => {
    const owner = claimHeightfieldOwner();
    const syncHeightfields = (reason: string) => {
      if (currentHeightfieldOwner() !== owner) return;
      const baked = GAME_WORLD.registerHeightfields(worldGrid);
      if (baked.dropped > 0) console.warn(`${optionsRef.current.logTag} landforms past the heightfield slots: ${baked.dropped} not baked`);
      worldExtras?.registerHeightfields?.(baked);
      GAME_TELEMETRY.recordDiagnostic('physics', 'live-floor.sync', {
        reason,
        owner,
        hostReady: GAME_PHYSICS.hostReady() ? 1 : 0,
        surfaceRegions: worldGrid.surfaceRegions.length,
        placedCells: Object.keys(worldGrid.placedCells).length,
        landforms: worldGrid.landforms.length,
        heightfields: baked.fields.length,
        heightfieldDropped: baked.dropped,
        spawnGround: groundColumnTop(worldGrid, optionsRef.current.state.player.position.x, optionsRef.current.state.player.position.z),
      });
      if (!liveFloorProbeRef.current.worldPrinted) {
        const spawn = optionsRef.current.state.player.position;
        liveFloorProbeRef.current.worldPrinted = true;
        console.warn(`${optionsRef.current.logTag} live floor probe`, {
          reason,
          owner,
          hostReady: GAME_PHYSICS.hostReady(),
          surfaceRegions: worldGrid.surfaceRegions.length,
          placedCells: Object.keys(worldGrid.placedCells).length,
          landforms: worldGrid.landforms.length,
          heightfields: baked.fields.length,
          heightfieldDropped: baked.dropped,
          spawn: { x: spawn.x, y: spawn.y, z: spawn.z },
          spawnGround: groundColumnTop(worldGrid, spawn.x, spawn.z),
        });
      }
    };
    registerHeightfieldsRef.current = syncHeightfields;
    syncHeightfields('mount-or-world-change');
    return () => {
      if (currentHeightfieldOwner() === owner) {
        GAME_TELEMETRY.recordDiagnostic('physics', 'live-floor.clear', { owner });
        GAME_PHYSICS.clearHeightfields();
      } else {
        GAME_TELEMETRY.recordDiagnostic('physics', 'live-floor.stale-clear-skipped', {
          owner,
          currentOwner: currentHeightfieldOwner(),
        });
        console.warn(`${optionsRef.current.logTag} stale heightfield cleanup skipped`, {
          owner,
          currentOwner: currentHeightfieldOwner(),
        });
      }
    };
  }, [worldGrid, worldExtras]);

  const [player, setPlayer] = useState(() => initialPlayer(state, worldGrid));
  const playerRef = useRef(player);
  playerRef.current = player;
  const playerJitRenderRef = useRef<PlayerJitRenderedFrame>({
    x: player.x,
    y: player.y,
    z: player.z,
    yaw: player.yaw,
    pose: 'stand',
    gaitPhase: player.gaitPhase,
  });
  const playerJitProbeRef = useRef({
    active: false,
    done: false,
    startedAt: 0,
    lastAt: 0,
    frames: [] as PlayerJitFrame[],
    latestPhysics: { x: player.x, y: player.y, z: player.z, dt: 0, hostUs: 0 },
  });
  // V23 — THE CAMERA IS NOT JAVASCRIPT: framework/game/camera.zig owns every
  // frame (solve/smoothing, writes the bound Scene3D.Camera node fields).
  // JS keeps only a yaw/pitch SHADOW ref — movement stays camera-relative
  // (V7 needs the yaw) and the shadow mirrors the host exactly because the
  // SAME clamped deltas feed both sides. No React state: a camera drag is
  // zero render work.
  const lookRef = useRef({ yaw: state.player.yawDegrees, pitch: PLAYER_CAMERA.initialPitchDegrees });
  const cameraRef = useRef<any>(null);
  const nativeCameraRef = useRef<ReturnType<typeof GAME_NATIVE_CAMERA.forNode> | null>(null);
  const keysRef = useRef<ReturnType<typeof GAME_INPUT.createKeyState> | null>(null);
  // Mouse capture (addendum 4): true while the route consumes the mouse —
  // relative-mode look, click = intent. State mirrors the ref for route chrome.
  const capturedRef = useRef(false);
  const [mouseCaptured, setMouseCaptured] = useState(false);
  // left-button edge memory for the captured-click → onTap dispatch
  const leftWasDownRef = useRef(false);
  // ADS aim (the ruled camera is REGISTRY-WITH-AIM, Q3/Q3b): right-mouse hold
  // per INPUT_BINDINGS' 'aim' binding (pointer: 'right'), read through the
  // door's pointer wire each frame. A ref — mode rides the controller, not
  // a render. Honesty: when the pointer host fns are missing, rightDown
  // reads false and the hint says so. Routes opt in via options.aim.
  const aimRef = useRef(false);
  const pointerWire = useMemo(() => GAME_INPUT.availability(), []);

  // Send the CURRENT rig params to the controller — called on change only
  // (pose published, mode switched, route reset). Drag deltas go through
  // setInputDeltas instead; idle frames send nothing.
  const sendCameraParamsTo = (camera: ReturnType<typeof GAME_NATIVE_CAMERA.forNode>, pose: { x: number; y: number; z: number }) => {
    const l = lookRef.current;
    if (aimRef.current) {
      camera.setAim({ target: [pose.x, pose.y, pose.z], yaw: l.yaw, pitch: orbitPitchToAimPitch(l.pitch) });
    } else {
      camera.setOrbit({
        target: [pose.x, pose.y + PLAYER_CAMERA.targetHeightMeters, pose.z],
        yaw: l.yaw,
        pitch: l.pitch,
        distance: PLAYER_CAMERA.distanceMeters,
        fov: PLAYER_CAMERA.fovDegrees,
      });
    }
  };
  const sendCameraParams = (pose: { x: number; y: number; z: number }) => {
    const camera = nativeCameraRef.current;
    if (camera) sendCameraParamsTo(camera, pose);
  };
  const sendCameraRef = useRef(sendCameraParams);
  sendCameraRef.current = sendCameraParams;
  const setCameraDistanceConstraint = (distanceMeters: number, minDistanceMeters: number, smoothingPerSecond: number) => {
    nativeCameraRef.current?.setDistanceConstraint(distanceMeters, minDistanceMeters, smoothingPerSecond);
  };

  // Engage the controller: params first (a set before init pins the boot
  // frame — no swoop-in), then bind the route's Scene3D.Camera node. The
  // declarative camera props stay STATIC, so React never fights the host's
  // per-frame writes; disable on unmount returns the node to JS props.
  useEffect(() => {
    const nodeId = Number(cameraRef.current?.id ?? 0);
    if (!nodeId) {
      console.warn(`${optionsRef.current.logTag} native camera not engaged — camera node id unavailable`);
      return;
    }
    const camera = GAME_NATIVE_CAMERA.forNode(nodeId);
    nativeCameraRef.current = camera;
    sendCameraParamsTo(camera, playerRef.current);
    camera.setMode('walk');
    return () => {
      camera.disable();
      if (nativeCameraRef.current === camera) nativeCameraRef.current = null;
    };
  }, []);

  // The V2 player figure: seeded documents → part meshes, built once. The
  // per-update rig solve below is the editor-preview path (V2-AMENDED).
  const figure = useMemo(() => {
    const doc = GAME_FIGURE.generateFace(PLAYER_FIGURE_SEED);
    const parts = buildPartRender(doc, GAME_FIGURE.hedDepthGrid(doc), options.figureCartKey, PLAYER_FIGURE_SEED);
    return { doc, parts };
  }, []);
  // Camera-feel fix after V23: the camera no longer pays the figure's React
  // update cost, so the player model must stay frame-continuous. The old
  // quantized gait path made body/clothing transforms update at ~19Hz while
  // the root offset moved at frame cadence; that read as PLAYERJIT-0605.
  const pose: 'walk' | 'stand' = player.moving ? 'walk' : 'stand';
  const rig = useMemo(() => GAME_FIGURE.buildRigFrame('neutral', pose, player.gaitPhase), [pose, player.gaitPhase]);
  const figureOffset = useMemo<[number, number, number]>(() => [player.x, player.y, player.z], [player.x, player.y, player.z]);

  useEffect(() => {
    const next = initialPlayer(state, worldGrid);
    playerRef.current = next;
    setPlayer(next);
    lookRef.current.yaw = state.player.yawDegrees;
    sendCameraRef.current(next);
  }, [state, worldGrid]);

  // Key transport: the door's held-keys snapshot (blur-clears on focus loss).
  useEffect(() => {
    const keys = GAME_INPUT.createKeyState();
    keysRef.current = keys;
    return () => {
      keysRef.current = null;
      keys.dispose();
    };
  }, []);

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
      // WASD per the ruled control contract (INPUT_BINDINGS), gated so typing
      // never walks the player — a focused TextInput OR the mode layer's gate
      // (test: the open console; the game keeps playing, only key reads stop).
      const typing = (optionsRef.current.isTyping?.() ?? false) || GAME_INPUT.isTextEditing();
      // Captured-mouse look (addendum 4): the camera follows raw relative
      // motion off the delta wire — no button held, like any shooter. The
      // click is then ALWAYS intent: a left-button down-edge while captured
      // is the mode layer's tap (build: place), never a camera gesture.
      if (capturedRef.current) {
        const motion = GAME_INPUT.readPointerDelta();
        if (motion.dx !== 0 || motion.dy !== 0) applyLook(motion.dx, motion.dy);
        const leftDown = GAME_INPUT.readPointer().leftDown;
        if (leftDown && !leftWasDownRef.current && !typing) optionsRef.current.onTap?.();
        leftWasDownRef.current = leftDown;
      }
      const probe = playerJitProbeRef.current;
      const probeEnabled = optionsRef.current.playerJitProbe === true && !probe.done;
      if (probeEnabled && !probe.active) {
        probe.active = true;
        probe.startedAt = now;
        probe.lastAt = 0;
        probe.frames = [];
        probe.latestPhysics = { x: playerRef.current.x, y: playerRef.current.y, z: playerRef.current.z, dt: 0, hostUs: 0 };
        GAME_TELEMETRY.clearDiagnostics();
        GAME_TELEMETRY.setDiagnosticChannel('camera', true);
        GAME_TELEMETRY.recordDiagnostic('camera', 'playerjit.armed', { frames: 120 });
      }
      const axes = probe.active ? { forward: 1, strafe: 0 } : (keys && !typing ? GAME_INPUT.moveAxes(keys) : { forward: 0, strafe: 0 });
      const running = probe.active ? false : (keys != null && !typing && GAME_INPUT.actionDown(keys, 'run'));
      const jumpDown = keys != null && !typing && GAME_INPUT.actionDown(keys, 'jump');
      const crouchDown = keys != null && !typing && GAME_INPUT.actionDown(keys, 'crouch');
      // ADS trigger (aim-enabled routes only): the bindings' 'aim' input is
      // right-mouse hold, read through the door's pointer wire (honest false
      // when unwired). The walk<->aim transition rides the controller:
      // setMode + full params; the host's retained smoothing animates it.
      // The block also runs while aimRef is STILL set after the option turned
      // off (PLAYFOLD-0605: F2 mid-ADS flips the mode prop live) — the next
      // frame reads aim=false and folds the camera back to walk.
      if (optionsRef.current.aim || aimRef.current) {
        const aim = optionsRef.current.aim === true && !typing && GAME_INPUT.readPointer().rightDown;
        if (aim !== aimRef.current) {
          const l = lookRef.current;
          const beforeBodyYaw = playerRef.current.yaw;
          const before = {
            transition: aim ? 'walk->aim' : 'aim->walk',
            cameraYaw: l.yaw,
            orbitPitch: l.pitch,
            aimPitch: orbitPitchToAimPitch(l.pitch),
            bodyYaw: beforeBodyYaw,
            bodyYawIfAiming: figureYawForCameraYaw(l.yaw),
          };
          aimRef.current = aim;
          // leaving ADS: fold the wider aim pitch back into the orbit clamp
          if (!aim) {
            l.pitch = clamp(l.pitch, PLAYER_CAMERA.minPitchDegrees, PLAYER_CAMERA.maxPitchDegrees);
          }
          nativeCameraRef.current?.setMode(aim ? 'aim' : 'walk');
          sendCameraRef.current(playerRef.current);
          const after = {
            ...before,
            orbitPitch: l.pitch,
            aimPitch: orbitPitchToAimPitch(l.pitch),
            bodyYawAfterTransition: aim ? figureYawForCameraYaw(l.yaw) : beforeBodyYaw,
          };
          GAME_TELEMETRY.recordDiagnostic('camera', 'aimPitch.transition', after);
          console.warn(`${optionsRef.current.logTag} aim camera transition`, after);
        }
      }
      // The V7 cart-side duty: ship a camera-relative direction vector.
      const intent = GAME_INPUT.moveIntent(axes, lookRef.current.yaw * DEG);
      const moving = intent.x !== 0 || intent.z !== 0;
      const prev = playerRef.current;
      const speeds = optionsRef.current.speeds?.() ?? state.player;
      const noclip = speeds.noclip === true;
      const authoredGroundExists = worldGrid.surfaceRegions.length > 0
        || Object.keys(worldGrid.placedCells).length > 0
        || worldGrid.landforms.length > 0;
      const columnTop = groundColumnTop(worldGrid, prev.x, prev.z);
      const physicsTuning = optionsRef.current.physicsTuning?.() ?? state.config.physics;
      const probeInput: PlayerJitFrame['input'] = {
        axesForward: axes.forward,
        axesStrafe: axes.strafe,
        intentX: intent.x,
        intentZ: intent.z,
        moving,
        running,
        jump: jumpDown,
        crouch: crouchDown,
        noclip,
      };
      const recordProbeFrame = (correction: PlayerJitFrame['correction']) => {
        if (!probe.active || probe.done) return;
        const camera = readEmbodiedCameraNode(cameraRef.current);
        const rendered = playerJitRenderRef.current;
        const row: PlayerJitFrame = {
          frame: probe.frames.length + 1,
          tMs: now - probe.startedAt,
          dtMs: probe.lastAt > 0 ? now - probe.lastAt : 0,
          input: probeInput,
          rendered: { ...rendered },
          physics: { ...probe.latestPhysics },
          camera,
          animation: { pose: rendered.pose, gaitPhase: rendered.gaitPhase },
          correction,
        };
        probe.lastAt = now;
        probe.frames.push(row);
        GAME_TELEMETRY.recordDiagnostic('camera', 'playerjit.frame', {
          frame: row.frame,
          intentX: row.input.intentX,
          intentZ: row.input.intentZ,
          renderX: row.rendered.x,
          renderY: row.rendered.y,
          renderZ: row.rendered.z,
          physicsX: row.physics.x,
          physicsY: row.physics.y,
          physicsZ: row.physics.z,
          cameraX: row.camera.x ?? 0,
          cameraY: row.camera.y ?? 0,
          cameraZ: row.camera.z ?? 0,
          gaitPhase: row.animation.gaitPhase,
          correctionKind: row.correction.kind,
          correctionRegistered: row.correction.registered ? 1 : 0,
        });
        if (probe.frames.length >= 120) {
          probe.done = true;
          probe.active = false;
          writePlayerJitWitness(probe.frames);
          GAME_TELEMETRY.diagnosticDump('playerjit-0606');
          GAME_TELEMETRY.setDiagnosticChannel('camera', false);
        }
      };
      // Reference pv_noclip behavior: cheats gate in the console command;
      // movement bypasses collision/ground resolution, Space flies up, C/Ctrl
      // flies down, velocity is zeroed, and the player is never grounded.
      if (noclip) {
        const baseSpeed = running ? speeds.runSpeedMetersPerSecond : speeds.walkSpeedMetersPerSecond;
        const intentLength = Math.hypot(intent.x, intent.z);
        const moveX = intentLength > MOVEMENT_INTENT_DEADZONE ? intent.x / intentLength : 0;
        const moveZ = intentLength > MOVEMENT_INTENT_DEADZONE ? intent.z / intentLength : 0;
        const verticalIntent = (jumpDown ? 1 : 0) - (crouchDown ? 1 : 0);
        const movingNoClip = intentLength > MOVEMENT_INTENT_DEADZONE || verticalIntent !== 0;
        const desiredYaw = intentLength > MOVEMENT_INTENT_DEADZONE
          ? normalizeYawDegrees(Math.atan2(-moveX, -moveZ) / DEG)
          : prev.yaw;
        if (movingNoClip || prev.moving || prev.running || prev.grounded || prev.yaw !== desiredYaw || prev.vx !== 0 || prev.vy !== 0 || prev.vz !== 0) {
          const next: PlayerPose = {
            ...prev,
            x: prev.x + moveX * baseSpeed * dt,
            y: Math.max(NOCLIP_MIN_HEIGHT_METERS, prev.y + verticalIntent * baseSpeed * dt),
            z: prev.z + moveZ * baseSpeed * dt,
            vx: 0,
            vy: 0,
            vz: 0,
            grounded: false,
            yaw: desiredYaw,
            moving: movingNoClip,
            running: movingNoClip && running,
            gaitPhase: movingNoClip ? prev.gaitPhase + dt * (running ? GAIT.runCyclesPerSecond : GAIT.walkCyclesPerSecond) : prev.gaitPhase,
          };
          playerRef.current = next;
          playerJitProbeRef.current.latestPhysics = { x: next.x, y: next.y, z: next.z, dt, hostUs: 0 };
          setPlayer(next);
          sendCameraRef.current(next);
        }
        recordProbeFrame({ kind: 'noclip-bypass' });
        optionsRef.current.onFrame?.();
        handle = GAME_LOOP.scheduleFrame(loop);
        return;
      }
      const recovery = liveFloorRecoveryDecision({
        authoredGroundExists,
        player: prev,
        columnTop,
        capsuleHeightMeters: physicsTuning.playerCapsuleHeightMeters,
        tuning: physicsTuning,
        heightfields: worldHeightfields.fields,
      });
      if (recovery.shouldRecover) {
        if (recovery.shouldRegister) registerHeightfieldsRef.current(recovery.reason);
        const next: PlayerPose = {
          ...prev,
          y: columnTop,
          vx: 0,
          vy: 0,
          vz: 0,
          grounded: true,
          moving: false,
          running: false,
        };
        playerRef.current = next;
        setPlayer(next);
        sendCameraRef.current(next);
        if (liveFloorProbeRef.current.recoveries < LIVE_FLOOR_PROBE.maxRecoveryLogs) {
          liveFloorProbeRef.current.recoveries += 1;
          GAME_TELEMETRY.recordDiagnostic('physics', 'live-floor.recovery', {
            reason: recovery.reason,
            registered: recovery.shouldRegister ? 1 : 0,
            fromY: prev.y,
            toY: columnTop,
            x: prev.x,
            z: prev.z,
            hostReady: recovery.hostReady ? 1 : 0,
            fieldCount: recovery.fieldCount,
            fieldUnderPlayer: recovery.fieldUnderPlayer ? 1 : 0,
            thresholdY: recovery.recoveryThresholdY,
            probeY: recovery.probeY ?? -999999,
            probeGrounded: recovery.probeGrounded === true ? 1 : 0,
            solidRects: solids.rects.length,
            orientedRects: solids.orientedRects.length,
          });
          console.warn(`${optionsRef.current.logTag} live floor recovery`, {
            reason: recovery.reason,
            registered: recovery.shouldRegister,
            fromY: prev.y,
            toY: columnTop,
            x: prev.x,
            z: prev.z,
            hostReady: recovery.hostReady,
            fieldCount: recovery.fieldCount,
            fieldUnderPlayer: recovery.fieldUnderPlayer,
            thresholdY: recovery.recoveryThresholdY,
            probeY: recovery.probeY,
            probeGrounded: recovery.probeGrounded,
            solidRects: solids.rects.length,
            orientedRects: solids.orientedRects.length,
          });
        }
        recordProbeFrame({
          kind: 'live-floor-recovery',
          reason: recovery.reason,
          registered: recovery.shouldRegister,
          fromY: prev.y,
          toY: columnTop,
        });
        optionsRef.current.onFrame?.();
        handle = GAME_LOOP.scheduleFrame(loop);
        return;
      }
      // Facing: ADS pins the body to the camera yaw (the crosshair law's
      // frame); walking faces the move direction; idle keeps the last facing.
      const desiredYaw = aimRef.current
        ? figureYawForCameraYaw(lookRef.current.yaw)
        : moving ? normalizeYawDegrees(Math.atan2(-intent.x, -intent.z) / DEG) : prev.yaw;
      // Surface under the player through the door: footing kind → the
      // captured kind table's surface profile (the reference behavior — mud
      // slows you, asphalt doesn't). No-tile fallback = the observed 'road'.
      const footing = GAME_WORLD.footingKindAtWorldPosition(worldGrid, { x: prev.x, y: prev.y, z: prev.z });
      const surfaceProfile = footing ? GAME_KINDS.tiles.get(footing).surface : FALLBACK_SURFACE;
      // P2: speeds are data — the mode layer may own a live source (test: the
      // console ctx, so `gv_speed` drives the real walk/run); the default is
      // the authored GameState — scaled by the footing's walk/run multiplier.
      const baseSpeed = running ? speeds.runSpeedMetersPerSecond : speeds.walkSpeedMetersPerSecond;
      const speed = baseSpeed * (running ? surfaceProfile.runSpeedMultiplier : surfaceProfile.walkSpeedMultiplier);
      // The host owns integration (V7): movement blend, gravity, the jump arc
      // (WO-1-proven), ground/step resolution — tuning is the authored
      // state.config.physics, colliders + heightfields are the W-1 door's
      // (GAME_WORLD.collisionRects / registerHeightfields, mounted above).
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
            tuning: physicsTuning,
            rects: solids.rects,
            orientedRects: solids.orientedRects,
          })
        : null;
      if (stepped) {
        const p = stepped.player;
        playerJitProbeRef.current.latestPhysics = {
          x: p.position.x,
          y: p.position.y,
          z: p.position.z,
          dt,
          hostUs: stepped.hostMicroseconds,
        };
        // The hostPhysics idle discipline: a resting step publishes no new pose.
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
          sendCameraRef.current(next); // target moved — params on change
        }
        recordProbeFrame({ kind: 'host-step' });
      } else if (moving) {
        // Honest fallback when the host bindings are absent (headless, or a
        // host built before the has-game-physics gate flipped): the old
        // kinematic advance + ground pin. No jump here — the arc is host-side.
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
        playerJitProbeRef.current.latestPhysics = { x, y: next.y, z, dt, hostUs: 0 };
        setPlayer(next);
        sendCameraRef.current(next); // target moved — params on change
        recordProbeFrame({ kind: 'js-fallback' });
      } else if (prev.moving || prev.running || prev.yaw !== desiredYaw) {
        const next = { ...prev, vx: 0, vz: 0, moving: false, running: false, yaw: desiredYaw };
        playerRef.current = next;
        setPlayer(next);
        recordProbeFrame({ kind: 'idle-stop' });
      } else {
        recordProbeFrame({ kind: 'none' });
      }
      // the mode layer's per-frame duty (build: re-resolve the crosshair)
      optionsRef.current.onFrame?.();
      handle = GAME_LOOP.scheduleFrame(loop);
    };
    handle = GAME_LOOP.scheduleFrame(loop);
    return () => {
      alive = false;
      if (handle != null) GAME_LOOP.cancelFrame(handle);
    };
  }, [state, worldGrid, worldHeightfields, solids]);

  // Captured-mouse look (addendum 4 — game-style, no button held). While ADS
  // is held the pitch clamp widens to the Aim rig's own limits — "aiming
  // needs the sky" (the aim ceiling was Q3's whole reason to exist).
  const applyLook = (dx: number, dy: number) => {
    const limits = aimRef.current
      ? aimPitchLimitsInOrbitSpace()
      : { min: PLAYER_CAMERA.minPitchDegrees, max: PLAYER_CAMERA.maxPitchDegrees };
    // Horizontal sign: the engine renders world +X as screen-LEFT (the
    // movement.zig mirror), and both rigs use compass yaw (yaw+ = CCW from
    // above) — so yaw must DECREASE with a rightward motion for the view to
    // turn screen-right. USER VERDICT pinned this: "left to right backwards,
    // not top to bottom". The controller ADDS deltas to its params, so the
    // sign rides the delta; clamps apply HERE so the shadow and the host
    // accumulate identically (only the post-clamp delta is sent).
    const l = lookRef.current;
    const nextYaw = l.yaw - dx * PLAYER_CAMERA.yawDegreesPerPixel;
    const nextPitch = clamp(l.pitch - dy * PLAYER_CAMERA.pitchDegreesPerPixel, limits.min, limits.max);
    const pitchDelta = nextPitch - l.pitch;
    nativeCameraRef.current?.setInputDeltas(nextYaw - l.yaw, aimRef.current ? -pitchDelta : pitchDelta);
    l.yaw = nextYaw;
    l.pitch = nextPitch;
  };

  // Consume the mouse: relative mode on (cursor hides, motion reroutes to the
  // delta wire). The accumulated delta is DRAINED so entry never snaps the
  // view, and the capturing click is swallowed (it must not place). Honesty:
  // an unwired host warns loudly — never a silent drag fallback (the user
  // ruled drag out: it placed pieces while orbiting).
  const captureMouse = useRef(() => {
    if (capturedRef.current) return;
    if (!GAME_INPUT.setPointerCapture(true)) {
      console.warn(`${optionsRef.current.logTag} mouse capture unwired — look unavailable (host missing __mouse_capture; rebuild)`);
      return;
    }
    GAME_INPUT.readPointerDelta(); // drain motion accumulated while released
    leftWasDownRef.current = true; // swallow the click that captured
    capturedRef.current = true;
    setMouseCaptured(true);
  }).current;
  const releaseMouse = useRef(() => {
    if (!capturedRef.current) return;
    GAME_INPUT.setPointerCapture(false);
    capturedRef.current = false;
    setMouseCaptured(false);
  }).current;

  // Entering the route consumes the mouse; leaving it MUST hand it back.
  useEffect(() => {
    captureMouse();
    return () => {
      releaseMouse();
    };
  }, []);
  // Esc releases the mouse back to the UI (clicking the viewport re-captures).
  useEffect(() => {
    const off = GAME_INPUT.onKeyDown((event) => {
      if (String(event?.key ?? '').toLowerCase() === 'escape') releaseMouse();
    });
    return off;
  }, []);

  // Stable across renders: mode layers capture these in memos (the console's
  // afterRun closes over adoptPose once and teleports forever).
  const adoptPose = useRef((next: PlayerPose) => {
    playerRef.current = next;
    setPlayer(next);
    sendCameraRef.current(next); // teleport — the camera follows
  }).current;
  const resetPlayer = () => {
    const next = initialPlayer(state, worldGrid);
    playerRef.current = next;
    setPlayer(next);
    lookRef.current.yaw = next.yaw;
    sendCameraRef.current(next);
  };

  // The DECLARATIVE camera is the boot frame only — static props, so React
  // never sends camera UPDATEs after mount; framework/game/camera.zig writes
  // these node fields every frame once bound (V23). Both ruled modes ride the
  // controller: walk = Orbit (the pre-rewire framing), RMB ADS = Aim with the
  // reference defaults (shoulder 0.62m, fov 47, pitch clamps −66/+57° — full
  // above-horizon authority; the screen-center axis IS the fire ray per the
  // crosshair law).
  const [bootCam] = useState(() =>
    GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, {
      target: [playerRef.current.x, playerRef.current.y + PLAYER_CAMERA.targetHeightMeters, playerRef.current.z],
      yaw: lookRef.current.yaw,
      pitch: lookRef.current.pitch,
      dist: PLAYER_CAMERA.distanceMeters,
      fov: PLAYER_CAMERA.fovDegrees,
    }));
  const sceneState = {
    ...state,
    player: {
      ...state.player,
      position: { x: player.x, y: player.y, z: player.z } as Vec3,
      yawDegrees: player.yaw,
    },
  };

  // The active rig's natural (un-occluded) eye + the player-side pivot it sits
  // back from — what the camera-collision spring-arm casts against walls. ADS
  // frames over the shoulder pivot (Aim rig); walk orbits the chest target.
  // Reading the LIVE rig is the fix for "the aim camera still clips walls":
  // the occlusion query must follow whichever camera is actually rendering.
  const desiredCamera = (): { eye: Vec3; pivot: Vec3; baseDistance: number; aiming: boolean } => {
    const p = playerRef.current;
    const l = lookRef.current;
    if (aimRef.current) {
      const aim = GAME_CAMERA.rigs.Aim;
      const solved = GAME_CAMERA.solve(aim, { target: [p.x, p.y, p.z], yaw: l.yaw, pitch: orbitPitchToAimPitch(l.pitch) });
      const yawRad = l.yaw * DEG;
      const d = aim.defaults;
      return {
        eye: { x: solved.pos[0], y: solved.pos[1], z: solved.pos[2] },
        pivot: { x: p.x - Math.cos(yawRad) * d.shoulderShift, y: p.y + d.pivotHeight, z: p.z + Math.sin(yawRad) * d.shoulderShift },
        baseDistance: d.distance,
        aiming: true,
      };
    }
    const solved = GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, {
      target: [p.x, p.y + PLAYER_CAMERA.targetHeightMeters, p.z],
      yaw: l.yaw,
      pitch: l.pitch,
      dist: PLAYER_CAMERA.distanceMeters,
      fov: PLAYER_CAMERA.fovDegrees,
    });
    return {
      eye: { x: solved.pos[0], y: solved.pos[1], z: solved.pos[2] },
      pivot: { x: p.x, y: p.y + PLAYER_CAMERA.targetHeightMeters, z: p.z },
      baseDistance: PLAYER_CAMERA.distanceMeters,
      aiming: false,
    };
  };

  // Push the active rig's CURRENT params to the host (distance/fov/target read
  // fresh from PLAYER_CAMERA). Routes call this on a 'play-camera-feel' knob
  // edit so the new feel applies the same frame instead of waiting for the next
  // pose change.
  const resendCameraParams = () => sendCameraRef.current(playerRef.current);

  return {
    worldGrid,
    player,
    playerRef,
    lookRef,
    pointerWire,
    figure,
    rig,
    pose,
    figureOffset,
    sceneState,
    playerJitRenderRef,
    cameraRef,
    bootCam,
    mouseCaptured,
    captureMouse,
    releaseMouse,
    adoptPose,
    setCameraDistanceConstraint,
    desiredCamera,
    resendCameraParams,
    resetPlayer,
  };
}

/** The world render-capture set + the figure's face/skin unwrap captures. */
export function EmbodiedCaptures(props: { embodied: Embodied }) {
  const { sceneState, figure } = props.embodied;
  return (
    <>
      {/* GAP(W-2): world surface captures await the world render lane */}
      <TileSurfaceCaptures regions={sceneState.world.surfaceRegions} />
      <RoadSurfaceCaptures roads={sceneState.world.roads} />
      <RoadJunctionCaptures junctions={sceneState.world.junctions} />
      <LandformSurfaceCaptures landforms={sceneState.world.landforms ?? []} />
      <PropSurfaceCaptures props={sceneState.world.props} />
      {/* The V2 figure's face/skin unwrap captures (replaces HumanoidFaceCaptures) */}
      <CharacterCaptures
        headTexKey={figure.parts.head.texKey}
        skinTexKey={figure.parts.torso.texKey}
        skin={figure.doc.skin}
        layers={figure.doc.layers}
      />
    </>
  );
}

/** The embodied Scene3D: bound native camera + world statics + the player
 *  figure. Route 3D content (build: pieces/ghost) renders as children,
 *  between the world and the player. */
export function EmbodiedScene(props: { embodied: Embodied; children?: ReactNode }) {
  const { sceneState, cameraRef, bootCam, rig, figure, player, pose, figureOffset, playerJitRenderRef } = props.embodied;
  playerJitRenderRef.current = {
    x: figureOffset[0],
    y: figureOffset[1],
    z: figureOffset[2],
    yaw: player.yaw,
    pose,
    gaitPhase: player.gaitPhase,
  };
  return (
    /* GAP(W-3): game sky background awaits a captured home */
    <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={hmscSkyBackgroundColor(sceneState.config.sky)} showGrid={false} showAxes={false}>
      {/* STATIC boot frame — the V23 controller owns these fields per frame once bound */}
      <Scene3D.Camera nativeCamera ref={cameraRef} position={bootCam.pos} target={bootCam.target} fov={bootCam.fov} far={sceneState.config.view.drawRadiusMeters} />
      <Scene3D.Fog enabled={false} />
      {/* GAP(W-2): the world renderer awaits the world render lane */}
      <WorldStatics world={sceneState.world} skyConfig={sceneState.config.sky} />
      {props.children}
      <PlayerMeshes rig={rig} parts={figure.parts} yawDeg={player.yaw} offset={figureOffset} />
    </Scene3D>
  );
}

/** The full-area viewport surface: while the mouse is RELEASED, clicking the
 *  world (anywhere route chrome doesn't shadow) re-captures it. While
 *  captured, look + click ride the pointer wire in the frame loop — this
 *  surface is inert (the hidden cursor can't meaningfully hit-test). */
export function EmbodiedMouseSurface(props: { embodied: Embodied }) {
  return (
    <Pressable onMouseDown={props.embodied.captureMouse} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#00000001' }} />
  );
}
