// TestRoute — /test: walk the authored map. The FIRST real consumer of the
// @game ground floor (contract: TestRoute.REWIRE.md, committed before this
// rewrite). Every captured system arrives through the door; the items still
// reaching into cart/hmsc/** are marked GAP(W-1|W-2|W-3) and move behind the
// world lanes when those captures land — never half-captured here.
//
//   GAME_INPUT   keys (blur-clearing snapshot), WASD contract, camera-relative
//                moveIntent (the V7 cart-side duty: ship a direction vector),
//                typing gate.
//   GAME_CAMERA  Orbit rig solve — boot frame matched to the old hand trig.
//   GAME_LOOP    frame transport (rAF probe) + monotonic now.
//   GAME_FIGURE  the V2 kit player (seeded face, dressed rig); render via the
//                editor-preview path @game/figure/render (V2-AMENDED: per-frame
//                JS rig eval is editor/lab-only; the compiled game uses the bake).
//
// GAP(W-1) world grid: GameState types, ground-height sampling, the kinematic
//   advance (host integration per V7 needs the world→collider adapter), spawn.
// GAP(W-2) world render: WorldStatics + the surface-capture mounts.
// GAP(W-3) game sky: hmsc config.sky has no captured home (chrome's LabSky is
//   the lab environment, a different shape).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Pressable, Scene3D, Text } from '@reactjit/primitives';
import { GAME_CAMERA, GAME_FIGURE, GAME_INPUT, GAME_LOOP } from '@game';
import { CharacterCaptures, FigureMeshes, buildPartRender } from '@game/figure/render';
import type { GameState, Vec3 } from '../hmsc/design'; // GAP(W-1) awaiting world grid state
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
import { landformGroundTopAt } from '../hmsc/world/landforms'; // GAP(W-1) awaiting ground heights
import { surfaceRegionTopMeters } from '../hmsc/world/surfaceHeights'; // GAP(W-1)

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
} as const;
const FRAME = { minDtSeconds: 0.001, maxDtSeconds: 0.05 } as const;
const PLAYER_FIGURE_SEED = 1;
const PLAYER_FIGURE_CART_KEY = 'hmscint.test.player';

type PlayerPose = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  moving: boolean;
  running: boolean;
  /** walk-cycle phase in cycles (buildSkeleton's gait clock) */
  gaitPhase: number;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function normalizeYawDegrees(yawDegrees: number): number {
  return ((yawDegrees % 360) + 360) % 360;
}

// GAP(W-1): JS ground sampling. The captured home is host-side
// (GAME_PHYSICS.step + registerHeightfield) but feeding it needs the
// GameState-world → CollisionRect[]/Heightfield[] adapter the world-grid lane
// owns; sampling here keeps the route honest until W-1 lands.
function groundTop(state: GameState, x: number, z: number): number {
  let top = 0;
  const c = state.world.cellSizeMeters;
  for (const r of state.world.surfaceRegions) {
    if (x >= r.x * c && x <= (r.x + r.width) * c && z >= r.z * c && z <= (r.z + r.depth) * c) {
      top = Math.max(top, surfaceRegionTopMeters(r, c));
    }
  }
  return Math.max(top, landformGroundTopAt(state, x, z) ?? top);
}

// GAP(W-1): spawn glue — the world grid lane owns spawn/respawn (pv_respawn).
function initialPlayer(state: GameState): PlayerPose {
  const p = state.player;
  const y = groundTop(state, p.position.x, p.position.z);
  return { x: p.position.x, y, z: p.position.z, yaw: p.yawDegrees, moving: false, running: false, gaitPhase: 0 };
}

export function TestRoute(props: { state: GameState; mapName: string; onExit: () => void }) {
  const [player, setPlayer] = useState(() => initialPlayer(props.state));
  const playerRef = useRef(player);
  playerRef.current = player;
  const [look, setLook] = useState(() => ({ yaw: props.state.player.yawDegrees, pitch: CAMERA.initialPitchDegrees }));
  const lookRef = useRef(look);
  lookRef.current = look;
  const keysRef = useRef<ReturnType<typeof GAME_INPUT.createKeyState> | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  // The V2 player figure: seeded documents → part meshes, built once. The
  // per-update rig solve below is the editor-preview path (V2-AMENDED).
  const figure = useMemo(() => {
    const doc = GAME_FIGURE.generateFace(PLAYER_FIGURE_SEED);
    const parts = buildPartRender(doc, GAME_FIGURE.hedDepthGrid(doc), PLAYER_FIGURE_CART_KEY, PLAYER_FIGURE_SEED);
    return { doc, parts };
  }, []);
  const rig = GAME_FIGURE.buildRigFrame('neutral', player.moving ? 'walk' : 'stand', player.gaitPhase);

  useEffect(() => {
    const next = initialPlayer(props.state);
    playerRef.current = next;
    setPlayer(next);
    setLook((l) => ({ ...l, yaw: props.state.player.yawDegrees }));
  }, [props.state]);

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
      // into a TextInput never walks the player.
      const typing = GAME_INPUT.isTextEditing();
      const axes = keys && !typing ? GAME_INPUT.moveAxes(keys) : { forward: 0, strafe: 0 };
      const running = keys != null && !typing && GAME_INPUT.actionDown(keys, 'run');
      // The V7 cart-side duty: ship a camera-relative direction vector.
      const intent = GAME_INPUT.moveIntent(axes, lookRef.current.yaw * DEG);
      if (intent.x !== 0 || intent.z !== 0) {
        const prev = playerRef.current;
        // P2: speeds are authored GameState data (defaults 2.4/5.8 — already
        // one source of truth with GAME_COMMANDS.tuning.player; REWIRE.md).
        const speed = running ? props.state.player.runSpeedMetersPerSecond : props.state.player.walkSpeedMetersPerSecond;
        // GAP(W-1): kinematic advance + ground pin. Host integration
        // (GAME_PHYSICS.step) takes over when the world→collider adapter lands.
        const x = prev.x + intent.x * speed * dt;
        const z = prev.z + intent.z * speed * dt;
        const next: PlayerPose = {
          x,
          y: groundTop(props.state, x, z),
          z,
          yaw: normalizeYawDegrees(Math.atan2(-intent.x, -intent.z) / DEG),
          moving: true,
          running,
          gaitPhase: prev.gaitPhase + dt * (running ? GAIT.runCyclesPerSecond : GAIT.walkCyclesPerSecond),
        };
        playerRef.current = next;
        setPlayer(next);
      } else if (playerRef.current.moving || playerRef.current.running) {
        const next = { ...playerRef.current, moving: false, running: false };
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
  }, [props.state]);

  // Drag-orbit gesture: route chrome (visible-cursor drag; the door's
  // readPointerDelta capture-mode mouse-look is deliberately not adopted).
  const onDown = (e: any) => { dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0) }; };
  const onMove = (e: any) => {
    const d = dragRef.current;
    if (!d) return;
    const x = Number(e?.x ?? 0), y = Number(e?.y ?? 0);
    const dx = x - d.x, dy = y - d.y;
    d.x = x; d.y = y;
    setLook((l) => ({
      yaw: l.yaw + dx * CAMERA.yawDegreesPerPixel,
      pitch: clamp(l.pitch - dy * CAMERA.pitchDegreesPerPixel, CAMERA.minPitchDegrees, CAMERA.maxPitchDegrees),
    }));
  };
  const onUp = () => { dragRef.current = null; };
  const resetPlayer = () => {
    const next = initialPlayer(props.state);
    playerRef.current = next;
    setPlayer(next);
    setLook((l) => ({ ...l, yaw: next.yaw }));
  };

  // The camera through the door: Orbit rig, chest-height target.
  const cam = GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, {
    target: [player.x, player.y + CAMERA.targetHeightMeters, player.z],
    yaw: look.yaw,
    pitch: look.pitch,
    dist: CAMERA.distanceMeters,
    fov: CAMERA.fovDegrees,
  });
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
        <Scene3D.Camera position={cam.pos} target={cam.target} fov={cam.fov} far={sceneState.config.view.drawRadiusMeters} />
        <Scene3D.Fog enabled={false} />
        {/* GAP(W-2): the world renderer awaits the world render lane */}
        <WorldStatics world={sceneState.world} skyConfig={sceneState.config.sky} />
        <FigureMeshes rig={rig} parts={figure.parts} yawDeg={player.yaw} offset={[player.x, player.y, player.z]} />
      </Scene3D>

      <Pressable onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#00000001' }} />

      <Box style={{ position: 'absolute', left: 12, top: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable onPress={props.onExit} style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 6, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f1a2e' }}>
          <Text fontSize={11} color="#cbd5e1" style={{ fontWeight: 700 }}>Back</Text>
        </Pressable>
        <Pressable onPress={resetPlayer} style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 6, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f1a2e' }}>
          <Text fontSize={11} color="#cbd5e1" style={{ fontWeight: 700 }}>Drop in</Text>
        </Pressable>
        <Text fontSize={10} color="#64748b" style={{ fontFamily: 'monospace' }}>{props.mapName} · WASD move · drag camera · Shift run</Text>
      </Box>
    </Box>
  );
}
