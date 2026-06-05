// TestRoute — /test: walk the authored map. The FIRST real consumer of the
// @game ground floor (contract: TestRoute.REWIRE.md, committed before this
// rewrite). Every captured system arrives through the door; the items still
// reaching into cart/hmsc/** are marked GAP(W-1|W-2|W-3) and move behind the
// world lanes when those captures land — never half-captured here.
//
//   GAME_INPUT    keys (blur-clearing snapshot), WASD contract, camera-relative
//                 moveIntent (the V7 cart-side duty: ship a direction vector),
//                 typing gate.
//   GAME_NATIVE_CAMERA  V23 — THE CAMERA IS NOT JAVASCRIPT: the host
//                 controller (framework/game/camera.zig) owns every frame;
//                 JS sends rig params/mode/drag deltas ON CHANGE only. Both
//                 ruled modes (Q3/Q3b): Orbit walk + RMB ADS Aim. GAME_CAMERA
//                 remains only for the boot frame + the Aim pitch limits.
//   GAME_LOOP     frame transport (rAF probe) + monotonic now.
//   GAME_FIGURE   the V2 kit player (seeded face, dressed rig); render via the
//                 editor-preview path @game/figure/render (V2-AMENDED: per-frame
//                 JS rig eval is editor/lab-only; the compiled game uses the bake).
//   GAME_PHYSICS  the host step owns integration: movement blend, gravity,
//                 jump arc, ground/step resolution.
//   GAME_WORLD    W-1 CLOSED — colliders (collisionRects), terrain heightfields
//                 (registerHeightfields), footing→surface feel, ground heights.
//   GAME_COMMANDS the backtick console session (CS idiom) over the live route.
//
// GAP(W-2) world render: WorldStatics + the surface-capture mounts.
// GAP(W-3) game sky: hmsc config.sky has no captured home (chrome's LabSky is
//   the lab environment, a different shape).
// GAP(buildings) building/prop collision + interiors: its own NOT_YET lane.

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Pressable, Scene3D, Text } from '@reactjit/primitives';
import { GAME_CAMERA, GAME_COMMANDS, GAME_FIGURE, GAME_INPUT, GAME_KINDS, GAME_LOOP, GAME_NATIVE_CAMERA, GAME_PHYSICS, GAME_WORLD } from '@game';
import type { WorldGridState } from '@game';
import { CharacterCaptures, FigureMeshes, buildPartRender } from '@game/figure/render';
import type { GameState, Vec3 } from '../hmsc/design'; // GAP: the editor GameState type retires when hmsc becomes compile/'s output (V15)
import { WorldStatics } from '../hmsc/render3d/GameWorld3D'; // GAP(W-2) awaiting world render
import { TileSurfaceCaptures } from '../hmsc/render3d/tileSurface'; // GAP(W-2)
import { RoadSurfaceCaptures } from '../hmsc/render3d/Road'; // GAP(W-2)
import { RoadJunctionCaptures } from '../hmsc/render3d/RoadJunctions'; // GAP(W-2)
import { LandformSurfaceCaptures } from '../hmsc/render3d/Landform'; // GAP(W-2)
import { BuildingSurfaceCaptures } from '../hmsc/render3d/BuildingFacades'; // GAP(W-2)
import { PropSurfaceCaptures } from '../hmsc/render3d/PropCaptures'; // GAP(W-2)
import { WorldPartCaptures } from '../hmsc/render3d/PartCaptures'; // GAP(W-2)
import { DriveInScreenCaptures } from '../hmsc/render3d/driveInScreen'; // GAP(W-2)
import { hmscSkyBackgroundColor } from '../hmsc/render3d/sky'; // GAP(W-3) awaiting game sky

const DEG = Math.PI / 180;

// Route presentation data (P2: named values, no inline numbers). The camera
// block reproduces the pre-rewrite boot frame exactly in Orbit-rig terms
// (REWIRE table #21); gait cadence is the V2 figure's walk cycle — promote to
// the figure tuning table when the P2 tuning surface lands.
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
  /** rig identity steps per gait cycle (the N-cached-bakes idiom) */
  framesPerCycle: 12,
} as const;
const FRAME = { minDtSeconds: 0.001, maxDtSeconds: 0.05 } as const;
const PLAYER_FIGURE_SEED = 1;
const PLAYER_FIGURE_CART_KEY = 'hmscint.test.player';
// Console overlay presentation (route chrome; the SESSION is captured —
// GAME_COMMANDS.createConsoleSession owns toggle/dispatch/transcript).
const CONSOLE_UI = {
  heightPercent: '46%',
  backdrop: '#0b1220e8',
  maxVisibleLines: 22,
  lineColor: { input: '#93c5fd', output: '#d1fae5', error: '#fb7185' } as Record<string, string>,
} as const;

// memo() so the 57-mesh figure subtree only re-diffs when rig/offset/yaw
// actually change — an idle camera drag must not pay the figure.
const PlayerMeshes = memo(FigureMeshes);

type PlayerPose = {
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

function normalizeYawDegrees(yawDegrees: number): number {
  return ((yawDegrees % 360) + 360) % 360;
}

// The authored GameState's world slice IS the captured world-grid shape
// (the editor lowers paint/placements into these exact records) — this view
// is what every GAME_WORLD call takes. W-1 CLOSED: colliders, ground heights,
// and footing all flow from the door now. Buildings/props collision stays
// with its own lane ('buildings + interiors' in NOT_YET_CAPTURED).
function worldGridOf(state: GameState): WorldGridState {
  return {
    cellSizeMeters: state.world.cellSizeMeters,
    surfaceRegions: state.world.surfaceRegions as unknown as WorldGridState['surfaceRegions'],
    placedCells: state.world.placedCells as unknown as WorldGridState['placedCells'],
    landforms: (state.world.landforms ?? []) as unknown as WorldGridState['landforms'],
  };
}

// Spawn-column ground: the highest standable top at (x, z) regardless of the
// player's current y — region tops + landform surface, all door math. (The
// door's groundTopAtWorldPosition is step-gated from a KNOWN y; spawning has
// none yet, so the column scan stays route glue over door functions.)
function spawnGroundTop(world: WorldGridState, x: number, z: number): number {
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
  const y = spawnGroundTop(world, p.position.x, p.position.z);
  return {
    x: p.position.x, y, z: p.position.z,
    vx: 0, vy: 0, vz: 0, grounded: true,
    yaw: p.yawDegrees, moving: false, running: false, gaitPhase: 0,
  };
}

export function TestRoute(props: { state: GameState; mapName: string; onExit: () => void }) {
  // W-1 CLOSED: the door's view over the authored world — every GAME_WORLD
  // call (colliders, heightfields, footing, ground) takes this. Memoized per
  // authored state; the world is static while playing.
  const worldGrid = useMemo(() => worldGridOf(props.state), [props.state]);
  // The flat solid bands of the captured layers (regions + placed cells —
  // blocking tiles like walls now BLOCK). Buildings/props stay with their lane.
  const colliders = useMemo(() => {
    const built = GAME_WORLD.collisionRects(worldGrid);
    if (built.dropped > 0) console.warn(`[test] world colliders past the host cap: ${built.dropped} dropped`);
    return built;
  }, [worldGrid]);
  // Terrain heightfields → host collider slots (see-it == walk-it: painted
  // hills are walkable, slopes resolve host-side). No-op until the host
  // carries has-game-physics; cleared on unmount so other routes start clean.
  useEffect(() => {
    const baked = GAME_WORLD.registerHeightfields(worldGrid);
    if (baked.dropped > 0) console.warn(`[test] landforms past the heightfield slots: ${baked.dropped} not baked`);
    return () => {
      GAME_PHYSICS.clearHeightfields();
    };
  }, [worldGrid]);

  const [player, setPlayer] = useState(() => initialPlayer(props.state, worldGrid));
  const playerRef = useRef(player);
  playerRef.current = player;
  // V23 — THE CAMERA IS NOT JAVASCRIPT: framework/game/camera.zig owns every
  // frame (solve/smoothing, writes the bound Scene3D.Camera node fields).
  // JS keeps only a yaw/pitch SHADOW ref — movement stays camera-relative
  // (V7 needs the yaw) and the shadow mirrors the host exactly because the
  // SAME clamped deltas feed both sides. No React state: a camera drag is
  // zero render work.
  const lookRef = useRef({ yaw: props.state.player.yawDegrees, pitch: CAMERA.initialPitchDegrees });
  const keysRef = useRef<ReturnType<typeof GAME_INPUT.createKeyState> | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  // ADS aim (the ruled camera is REGISTRY-WITH-AIM, Q3/Q3b): right-mouse hold
  // per INPUT_BINDINGS' 'aim' binding (pointer: 'right'), read through the
  // door's pointer wire each frame. A ref — mode rides the controller, not
  // a render. Honesty: when the pointer host fns are missing, rightDown
  // reads false and the hint says so.
  const aimRef = useRef(false);
  const pointerWire = useMemo(() => GAME_INPUT.availability(), []);

  // Send the CURRENT rig params to the controller — called on change only
  // (pose published, mode switched, route reset). Drag deltas go through
  // setInputDeltas instead; idle frames send nothing.
  const sendCameraParams = (pose: { x: number; y: number; z: number }) => {
    const l = lookRef.current;
    if (aimRef.current) {
      GAME_NATIVE_CAMERA.setAim({ target: [pose.x, pose.y, pose.z], yaw: l.yaw, pitch: l.pitch });
    } else {
      GAME_NATIVE_CAMERA.setOrbit({
        target: [pose.x, pose.y + CAMERA.targetHeightMeters, pose.z],
        yaw: l.yaw,
        pitch: l.pitch,
        distance: CAMERA.distanceMeters,
        fov: CAMERA.fovDegrees,
      });
    }
  };
  const sendCameraRef = useRef(sendCameraParams);
  sendCameraRef.current = sendCameraParams;

  // Engage the controller: params first (a set before init pins the boot
  // frame — no swoop-in), then bind the route's Scene3D.Camera node. The
  // declarative camera props below stay STATIC, so React never fights the
  // host's per-frame writes; disable on unmount returns the node to JS props.
  useEffect(() => {
    sendCameraRef.current(playerRef.current);
    GAME_NATIVE_CAMERA.setMode('walk');
    const bound = GAME_NATIVE_CAMERA.bindFirst();
    if (!bound) console.warn('[test] native camera not engaged — host missing has-game-camera (rebuild)');
    return () => {
      GAME_NATIVE_CAMERA.disable();
    };
  }, []);

  // The in-game console (CS idiom): backtick toggles an overlay; the session
  // is the captured GAME_COMMANDS console over a per-mount GameCommandState
  // seeded from the authored map (world slice COPIED — the console edits its
  // own copy; rendered-world unification is the world lane's integration
  // ticket). Pose syncs in before each command (pv_where tells the truth) and
  // position changes adopt back out (pv_teleport/pv_respawn move the player).
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
          playerRef.current = next;
          setPlayer(next);
          sendCameraRef.current(next); // teleport — the camera follows
        }
      },
    });
    return { ctx, session };
  }, [props.state]);
  // Mirror the session's revision into React state so the overlay re-renders
  // on toggle/typing/output. The game KEEPS PLAYING — nothing here pauses the
  // frame loop; it only gates key reads while open (below).
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

  // The V2 player figure: seeded documents → part meshes, built once. The
  // per-update rig solve below is the editor-preview path (V2-AMENDED).
  const figure = useMemo(() => {
    const doc = GAME_FIGURE.generateFace(PLAYER_FIGURE_SEED);
    const parts = buildPartRender(doc, GAME_FIGURE.hedDepthGrid(doc), PLAYER_FIGURE_CART_KEY, PLAYER_FIGURE_SEED);
    return { doc, parts };
  }, []);
  // Camera-feel fix (measured: the figure is 57 mesh nodes vs the old 19 — a
  // 3× bridge UPDATE storm that dragged the camera with it). The rig is memo'd
  // on (pose, quantized gait) and the mesh subtree on stable props, so an IDLE
  // camera drag diffs exactly one node: the camera. Gait quantizes to N steps
  // per cycle (the content-addressed N-bakes idiom) — identity only changes
  // ~19×/s while walking instead of every frame.
  const pose = player.moving ? 'walk' : 'stand';
  const gaitStep = Math.round(player.gaitPhase * GAIT.framesPerCycle) / GAIT.framesPerCycle;
  const rig = useMemo(() => GAME_FIGURE.buildRigFrame('neutral', pose, gaitStep), [pose, gaitStep]);
  const figureOffset = useMemo<[number, number, number]>(() => [player.x, player.y, player.z], [player.x, player.y, player.z]);

  useEffect(() => {
    const next = initialPlayer(props.state, worldGrid);
    playerRef.current = next;
    setPlayer(next);
    lookRef.current.yaw = props.state.player.yawDegrees;
    sendCameraRef.current(next);
  }, [props.state, worldGrid]);

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
      // never walks the player — a focused TextInput OR the open console (the
      // game keeps playing under the console; only its key reads stop).
      const typing = gameConsole.session.isOpen() || GAME_INPUT.isTextEditing();
      const axes = keys && !typing ? GAME_INPUT.moveAxes(keys) : { forward: 0, strafe: 0 };
      const running = keys != null && !typing && GAME_INPUT.actionDown(keys, 'run');
      const jumpDown = keys != null && !typing && GAME_INPUT.actionDown(keys, 'jump');
      // ADS trigger: the bindings' 'aim' input is right-mouse hold, read
      // through the door's pointer wire (honest false when unwired). The
      // walk<->aim transition rides the controller: setMode + full params;
      // the host's retained smoothing animates the framing change.
      const aim = !typing && GAME_INPUT.readPointer().rightDown;
      if (aim !== aimRef.current) {
        aimRef.current = aim;
        // leaving ADS: fold the wider aim pitch back into the orbit clamp
        if (!aim) {
          const l = lookRef.current;
          l.pitch = clamp(l.pitch, CAMERA.minPitchDegrees, CAMERA.maxPitchDegrees);
        }
        GAME_NATIVE_CAMERA.setMode(aim ? 'aim' : 'walk');
        sendCameraRef.current(playerRef.current);
      }
      // The V7 cart-side duty: ship a camera-relative direction vector.
      const intent = GAME_INPUT.moveIntent(axes, lookRef.current.yaw * DEG);
      const moving = intent.x !== 0 || intent.z !== 0;
      const prev = playerRef.current;
      // Facing: ADS pins the body to the camera yaw (the crosshair law's
      // frame); walking faces the move direction; idle keeps the last facing.
      const desiredYaw = aim
        ? normalizeYawDegrees(lookRef.current.yaw)
        : moving ? normalizeYawDegrees(Math.atan2(-intent.x, -intent.z) / DEG) : prev.yaw;
      // Surface under the player through the door: footing kind → the
      // captured kind table's surface profile (the reference behavior — mud
      // slows you, asphalt doesn't). No-tile fallback = the observed 'road'.
      const footing = GAME_WORLD.footingKindAtWorldPosition(worldGrid, { x: prev.x, y: prev.y, z: prev.z });
      const surfaceProfile = footing ? GAME_KINDS.tiles.get(footing).surface : FALLBACK_SURFACE;
      // P2: speeds are data — the console ctx is the live owner, SEEDED from
      // the authored GameState (defaults 2.4/5.8 = GAME_COMMANDS.tuning), so
      // `gv_speed` in the console drives the real walk/run on this route —
      // scaled by the footing's walk/run multiplier (movementSurfaceForPlayer).
      const baseSpeed = running ? gameConsole.ctx.player.runSpeedMetersPerSecond : gameConsole.ctx.player.walkSpeedMetersPerSecond;
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
            tuning: props.state.config.physics,
            rects: colliders.rects,
          })
        : null;
      if (stepped) {
        const p = stepped.player;
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
      } else if (moving) {
        // Honest fallback when the host bindings are absent (headless, or a
        // host built before the has-game-physics gate flipped): the old
        // kinematic advance + ground pin. No jump here — the arc is host-side.
        const x = prev.x + intent.x * speed * dt;
        const z = prev.z + intent.z * speed * dt;
        const next: PlayerPose = {
          ...prev,
          x,
          y: spawnGroundTop(worldGrid, x, z),
          z,
          yaw: desiredYaw,
          moving: true,
          running,
          gaitPhase: prev.gaitPhase + dt * (running ? GAIT.runCyclesPerSecond : GAIT.walkCyclesPerSecond),
        };
        playerRef.current = next;
        setPlayer(next);
        sendCameraRef.current(next); // target moved — params on change
      } else if (prev.moving || prev.running || prev.yaw !== desiredYaw) {
        const next = { ...prev, vx: 0, vz: 0, moving: false, running: false, yaw: desiredYaw };
        playerRef.current = next;
        setPlayer(next);
      }
      handle = GAME_LOOP.scheduleFrame(loop);
    };
    handle = GAME_LOOP.scheduleFrame(loop);
    return () => {
      alive = false;
      if (handle != null) GAME_LOOP.cancelFrame(handle);
    };
  }, [props.state, gameConsole, worldGrid, colliders]);

  // Drag-orbit gesture: route chrome (visible-cursor drag; the door's
  // readPointerDelta capture-mode mouse-look is deliberately not adopted).
  // While ADS is held the pitch clamp widens to the Aim rig's own limits —
  // "aiming needs the sky" (the aim ceiling was Q3's whole reason to exist).
  const onDown = (e: any) => { dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0) }; };
  const onMove = (e: any) => {
    const d = dragRef.current;
    if (!d) return;
    const x = Number(e?.x ?? 0), y = Number(e?.y ?? 0);
    const dx = x - d.x, dy = y - d.y;
    d.x = x; d.y = y;
    const limits = aimRef.current
      ? { min: GAME_CAMERA.rigs.Aim.defaults.minPitch as number, max: GAME_CAMERA.rigs.Aim.defaults.maxPitch as number }
      : { min: CAMERA.minPitchDegrees, max: CAMERA.maxPitchDegrees };
    // Horizontal sign: the engine renders world +X as screen-LEFT (the
    // movement.zig mirror), and both rigs use compass yaw (yaw+ = CCW from
    // above) — so yaw must DECREASE with a rightward drag for the view to
    // turn screen-right. USER VERDICT pinned this: "left to right backwards,
    // not top to bottom". The controller ADDS deltas to its params, so the
    // sign rides the delta; clamps apply HERE so the shadow and the host
    // accumulate identically (only the post-clamp delta is sent).
    const l = lookRef.current;
    const nextYaw = l.yaw - dx * CAMERA.yawDegreesPerPixel;
    const nextPitch = clamp(l.pitch - dy * CAMERA.pitchDegreesPerPixel, limits.min, limits.max);
    GAME_NATIVE_CAMERA.setInputDeltas(nextYaw - l.yaw, nextPitch - l.pitch);
    l.yaw = nextYaw;
    l.pitch = nextPitch;
  };
  const onUp = () => { dragRef.current = null; };
  const resetPlayer = () => {
    const next = initialPlayer(props.state, worldGrid);
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
      target: [playerRef.current.x, playerRef.current.y + CAMERA.targetHeightMeters, playerRef.current.z],
      yaw: lookRef.current.yaw,
      pitch: lookRef.current.pitch,
      dist: CAMERA.distanceMeters,
      fov: CAMERA.fovDegrees,
    }));
  const sceneState = {
    ...props.state,
    player: {
      ...props.state.player,
      position: { x: player.x, y: player.y, z: player.z } as Vec3,
      yawDegrees: player.yaw,
    },
  };

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
      {/* The V2 figure's face/skin unwrap captures (replaces HumanoidFaceCaptures) */}
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
        {/* GAP(W-2): the world renderer awaits the world render lane */}
        <WorldStatics world={sceneState.world} skyConfig={sceneState.config.sky} />
        <PlayerMeshes rig={rig} parts={figure.parts} yawDeg={player.yaw} offset={figureOffset} />
      </Scene3D>

      <Pressable onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#00000001' }} />

      <Box style={{ position: 'absolute', left: 12, top: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable onPress={props.onExit} style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 6, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f1a2e' }}>
          <Text fontSize={11} color="#cbd5e1" style={{ fontWeight: 700 }}>Back</Text>
        </Pressable>
        <Pressable onPress={resetPlayer} style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 6, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f1a2e' }}>
          <Text fontSize={11} color="#cbd5e1" style={{ fontWeight: 700 }}>Drop in</Text>
        </Pressable>
        <Text fontSize={10} color="#64748b" style={{ fontFamily: 'monospace' }}>
          {`${props.mapName} · WASD move · Space jump · Shift run · drag camera · \` console · ${pointerWire.complete ? 'RMB aim' : `aim unavailable (host missing: ${pointerWire.missing.join(', ')})`}`}
        </Text>
      </Box>

      {/* The console overlay — root's LAST child (overlays-last hit-test rule).
          Absolute over the top portion (CS style): the Scene3D underneath keeps
          its exact size — nothing reflows; the game keeps playing under it. */}
      {consoleOpen && (
        <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, height: CONSOLE_UI.heightPercent, backgroundColor: CONSOLE_UI.backdrop, borderBottomWidth: 2, borderBottomColor: '#334155', paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8 }}>
          <Box style={{ flexGrow: 1, justifyContent: 'flex-end', overflow: 'hidden', gap: 2 }}>
            {gameConsole.session.scrollOffset() > 0 && (
              <Text fontSize={10} color="#64748b" style={{ fontFamily: 'monospace' }}>
                {`— scrollback (${gameConsole.session.scrollOffset()} lines up) · PgDn to return —`}
              </Text>
            )}
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
