import { memo, useMemo } from 'react';
import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { GameState, PlacedCell, WorldSurfaceRegion } from '../design';
import { tileKindDefinition } from '../world/tileKinds';
import { surfaceRegionTopMeters } from '../world/surfaceHeights';
import { HMSC_GAMEPLAY_CAMERA } from '../gameplay/camera';
import { PlayerFigure } from './PlayerFigure';
import { floorTextureKey } from './tileSurface';
import { Road } from './Road';
import { CulDeSac, Intersection } from './RoadJunctions';
import { Prop } from './Prop';
import { GrassField, FlowerField, BushField, PalmFrondField, PalmTrunkField } from './GrassField';
import { Landform } from './Landform';
import { WaterBodies } from './WaterBody';
import { nearestLandformCameraHit } from '../world/landforms';
import { buildHmscSky } from './sky';
import { driftSky } from './skyDrift';
import { VoidShell } from './VoidShell';
import { worldCore, escapeDepth } from '../game/void/distance';
import { voidDistortion } from '../game/void/distortion';

// How far to keep the camera off a wall it pulls in to, so it never clips through.
const CAMERA_WALL_MARGIN_METERS = 0.35;
// Lower bound on the pulled-in distance fraction, so a wall right behind the
// player doesn't slam the camera onto the player's head.
const CAMERA_MIN_DISTANCE_FRACTION = 0.12;

// World renderer. A large tile field (surfaceRegion) is drawn as ONE textured
// floor mesh — the whole repeating tile grid is a single Effect captured to a
// texture (see tileSurface.tsx, mounted in HmscGameplayRig). Cost is one node
// per region no matter how many tiles, so 120x120 and 1200x1200 draw the same.
// Discrete placements (placedCells: doors, props) stay as individual meshes.
// 1 tile = 1 meter.

// One region = one thin slab sampling its captured tile-grid texture. The slab
// top is surfaceRegionTopMeters — the SAME value host physics uses for ground —
// so the player stands exactly on the visible floor. Unit-box params (literal →
// bakes); scale gives the real footprint.
function FloorMesh(props: { region: WorldSurfaceRegion; cellSizeMeters: number }) {
  const region = props.region;
  const c = props.cellSizeMeters;
  const thickness = tileKindDefinition(region.kind).render.heightMeters;
  const top = surfaceRegionTopMeters(region, c);
  // Host model matrix is translate*rotate*scale and Box is centered, so a
  // centered position spans [center - w/2, center + w/2] = the region.
  return (
    <Scene3D.Mesh
      geometry={Geometry.Box}
      // Top is the walkable floor; sides/bottom pin to the corner texel
      // (see hmsc AGENTS.md "Textured boxes").
      params={{ width: 1, height: 1, depth: 1, texturedFaces: ['top'] }}
      scale={[region.width * c, thickness, region.depth * c]}
      material="#ffffff"
      textureKey={floorTextureKey(region.id)}
      position={[
        (region.x + region.width / 2) * c,
        top - thickness / 2,
        (region.z + region.depth / 2) * c,
      ]}
    />
  );
}

// Discrete placed cell (door, prop). Literal params so the unit box bakes;
// material/position derive from the cell. height 0.2 mirrors
// HMSC_SCALE.floorTileThicknessMeters.
function PlacedCellMesh(props: { placedCell: PlacedCell }) {
  const render = tileKindDefinition(props.placedCell.kind).render;
  const cell = props.placedCell.cell;
  return (
    <Scene3D.Mesh
      geometry={Geometry.Box}
      params={{ width: 1, height: 0.2, depth: 1 }}
      material={render.color}
      position={[cell.x + 0.5, cell.y + 0.1, cell.z + 0.5]}
    />
  );
}

function Player(props: { state: GameState; animationSeconds: number; moving: boolean; running: boolean }) {
  const player = props.state.player;
  return (
    <PlayerFigure
      position={player.position}
      yawDegrees={player.yawDegrees}
      animationSeconds={props.animationSeconds}
      moving={props.moving}
      running={props.running}
    />
  );
}

// Everything in the scene that does NOT change when the player walks: skybox,
// lights, floor meshes, placed cells. Memoized + keyed only on `world` and the
// sky config (both keep identity across player/camera frames — the drive
// spreads `{...current, player}`), so a movement frame re-renders ONLY the
// camera and PlayerFigure, not the whole world tree. Without this, every step's
// setGameState re-reconciles all floor/placed/light nodes — the fps drop while
// moving. Mirrors the StaticSurface capture fix in tileSurface.tsx.
// Exported so the hmsc-int editor's iso preview renders the EXACT same static
// world the game draws (floors/roads/junctions/props/buildings/facades/landforms)
// — one renderer, no editor-side fork. The editor supplies its own <Scene3D> +
// camera + the matching TileSurfaceCaptures; this is just the world contents.
export const WorldStatics = memo(function WorldStatics(props: {
  world: GameState['world'];
  skyConfig: GameState['config']['sky'];
  showFlora?: boolean;
  // Void sky-drift weight (0 honest → 1 corrupted). Caller quantizes it so this
  // prop's identity is stable except when the drift has visibly stepped, keeping
  // the sky useMemo from re-deriving every movement frame near the city edge.
  skyDrift?: number;
}) {
  const world = props.world;
  const skyDrift = props.skyDrift ?? 0;
  // Default OFF (req_1640): the flora fields materialise the WHOLE grass/palm field in
  // JS (up to MAX_INSTANCES=1,048,576 blades) and ship it as ONE Scene3D.Instances
  // command — a 1M-row data array whose JSON.stringify is hundreds of MB, which OOMs
  // the editor heap on a grass-heavy map DURING serialization (no flush even logs).
  // Every ungated WorldStatics mount (IsoPreview, Embodied, the gameplay rig) was
  // building it; default off so the editor opens, and a caller opts in explicitly
  // (IsoAuthor's "Fl" toggle) when the map is light enough. Durable fix = the flora
  // refactor's shader preview (no million-row JS field / giant command).
  const showFlora = props.showFlora ?? false;
  const sky = useMemo(
    () => driftSky(
      buildHmscSky(props.skyConfig.hour, props.skyConfig.weather, props.skyConfig.gloom),
      skyDrift,
    ),
    [props.skyConfig.hour, props.skyConfig.weather, props.skyConfig.gloom, skyDrift],
  );
  return (
    <>
      {/* Analytic sky: gradient + sun disc/glow for the upper hemisphere; the
          dark "ground" hemisphere it draws for downward rays is hidden behind
          the floor mesh, so the sun the floor reflects is actually visible. The
          flat sky backgroundColor in HmscGameplayRig stays as the clear-color
          fallback. */}
      <Scene3D.Skybox
        zenith={sky.zenith}
        horizon={sky.horizon}
        ground={sky.ground}
        sunDir={sky.sunDir}
        sunColor={sky.sunColor}
        sunSize={sky.sunSize}
        sunGlow={sky.sunGlow}
        haze={sky.haze}
        cloud={sky.cloud}
        night={sky.night}
      />
      <Scene3D.AmbientLight color="#ffffff" intensity={sky.ambient} />
      <Scene3D.DirectionalLight direction={sky.sunDir} color={sky.lightColor} intensity={sky.lightIntensity} />
      {world.surfaceRegions.map((region) => (
        <FloorMesh key={region.id} region={region} cellSizeMeters={world.cellSizeMeters} />
      ))}
      {/* Roads draw over the chunk floors they sit on (their slab top is a hair
          higher), so a road's lanes/markings replace the plain tile field. */}
      {world.roads.map((road) => (
        <Road key={road.id} road={road} />
      ))}
      {/* Junctions draw over the roads they join (a hair higher again), so the
          crossing box / turnaround bulb masks the through-road markings. */}
      {world.junctions.map((junction) => (
        junction.kind === 'intersection'
          ? <Intersection key={junction.id} junction={junction} />
          : <CulDeSac key={junction.id} junction={junction} />
      ))}
      {Object.values(world.placedCells).map((placedCell) => (
        <PlacedCellMesh key={placedCell.key} placedCell={placedCell} />
      ))}
      {/* Space-filling street furniture — rocks, hydrants, signs, lights,
          bushes, traffic control — each sculpted by its kind through the Prop
          registry. Drawn after the ground/roads they stand on. */}
      {world.props.map((prop) => (
        <Prop key={prop.id} prop={prop} />
      ))}
      {/* Flora: painted grass, bush, and palm lanes populated as instanced fields
          (a surface population system, not props). Drawn after the floors they
          stand on, and switchable in the iso editor when it occludes building work. */}
      {showFlora ? (
        <>
          <GrassField world={world} />
          <FlowerField world={world} />
          <BushField world={world} />
          <PalmTrunkField world={world} />
          <PalmFrondField world={world} />
        </>
      ) : null}
      {/* Registry-driven landforms (mountains, hills, estates): ONE component for
          every kind — a Heightfield mesh baked from the kind's height function,
          tiled with the surface material, plus any kind decoration (crater lake,
          road ribbon). A new terrain shape is one registry entry, zero wiring. */}
      {(world.landforms ?? []).map((landform) => (
        <Landform key={landform.id} landform={landform} />
      ))}
      {/* Bodies of water (world/water): static flat-heightfield volumes at each
          body's level, drawn after the bed. All wave motion + the deep/shallow,
          foam, and Bayer-dither look live in the fixed host "~water~" pipeline
          (framework/gpu: shaders.water_wgsl), animated from the host clock — so
          the mesh is static and never re-renders, and /test + the compiled
          no-V8 loader render water identically. */}
      <WaterBodies bodies={world.waterBodies ?? []} />
    </>
  );
});

export function GameWorld3D(props: {
  state: GameState;
  cameraYawDegrees: number;
  cameraPitchRadians: number;
  aiming?: boolean;
  animationSeconds: number;
  playerMoving: boolean;
  playerRunning: boolean;
}) {
  const player = props.state.player.position;

  // Void state (SKYBOX_PLAYBOOK seam 1): how far past the believable core the
  // player has driven, and the corruption weights that flow from it. The core is
  // derived from the authored map's own bounds; escape_depth reads REAL distance
  // for now (the treadmill, seam 2, swaps the source). Memoized on the layout +
  // player cell so it only recomputes when the map changes or the player moves.
  const core = useMemo(() => worldCore(props.state.world), [props.state.world]);
  const depth = escapeDepth(player.x, player.z, core);
  const distortion = voidDistortion(depth);
  // Quantize the sky-drift weight so WorldStatics' sky memo only re-derives when
  // the drift has visibly stepped (every 0.04), not on every sub-step of motion.
  const skyDrift = Math.round(distortion.skyDrift / 0.04) * 0.04;

  // Real third-person camera: orbits the player by the rig's mouse-look yaw,
  // tilts with pitch, and shifts over the shoulder while aiming. Same math the
  // shipped rig used. The rig owns yaw/pitch; this only consumes them.
  const cameraYawRadians = props.cameraYawDegrees * Math.PI / 180;
  const right: [number, number, number] = [-Math.cos(cameraYawRadians), 0, Math.sin(cameraYawRadians)];
  const shoulderShift = props.aiming ? HMSC_GAMEPLAY_CAMERA.aimShoulderShiftMeters : 0;
  const cameraPosition: [number, number, number] = [
    player.x - Math.sin(cameraYawRadians) * HMSC_GAMEPLAY_CAMERA.distanceMeters + right[0] * shoulderShift,
    player.y + HMSC_GAMEPLAY_CAMERA.heightMeters,
    player.z - Math.cos(cameraYawRadians) * HMSC_GAMEPLAY_CAMERA.distanceMeters + right[2] * shoulderShift,
  ];
  const cameraTarget: [number, number, number] = [
    player.x + right[0] * shoulderShift * HMSC_GAMEPLAY_CAMERA.aimTargetShiftRatio,
    player.y + HMSC_GAMEPLAY_CAMERA.targetHeightMeters - props.cameraPitchRadians * HMSC_GAMEPLAY_CAMERA.pitchTargetMetersPerRadian,
    player.z + right[2] * shoulderShift * HMSC_GAMEPLAY_CAMERA.aimTargetShiftRatio,
  ];
  const cameraFov = props.aiming ? HMSC_GAMEPLAY_CAMERA.aimFovDegrees : HMSC_GAMEPLAY_CAMERA.fovDegrees;
  const view = props.state.config.view;

  const pivot = { x: player.x, y: player.y + HMSC_GAMEPLAY_CAMERA.targetHeightMeters, z: player.z };
  const desiredCamera = { x: cameraPosition[0], y: cameraPosition[1], z: cameraPosition[2] };
  // Pull in for the heightfield landforms: if the orbit would put the camera
  // inside a hill/mountain, stop it at the surface — no seeing inside the mesh from
  // a low angle.
  const landformHitFraction = nearestLandformCameraHit(props.state, pivot, desiredCamera);
  const hitFraction = landformHitFraction;
  const segmentLength = Math.hypot(desiredCamera.x - pivot.x, desiredCamera.y - pivot.y, desiredCamera.z - pivot.z);
  const marginFraction = segmentLength > 1e-3 ? CAMERA_WALL_MARGIN_METERS / segmentLength : 0;
  const cameraFraction = hitFraction < 1
    ? Math.max(CAMERA_MIN_DISTANCE_FRACTION, hitFraction - marginFraction)
    : 1;
  const resolvedCamera: [number, number, number] = [
    pivot.x + (desiredCamera.x - pivot.x) * cameraFraction,
    pivot.y + (desiredCamera.y - pivot.y) * cameraFraction,
    pivot.z + (desiredCamera.z - pivot.z) * cameraFraction,
  ];

  return (
    <>
      {/* far = draw radius: the world is culled + clipped past it, so a hilltop
          shows a hazed horizon, not the whole map. Fog (anchored to far unless
          fogNear/Far override) melts geometry into the sky before the cull edge. */}
      <Scene3D.Camera position={resolvedCamera} target={cameraTarget} fov={cameraFov} far={view.drawRadiusMeters} />
      <Scene3D.Fog near={view.fogNearMeters} far={view.fogFarMeters} />
      <WorldStatics world={props.state.world} skyConfig={props.state.config.sky} skyDrift={skyDrift} />
      {/* The procedural shell: the endless hash-city wrapping the authored core
          as the outer ring. Streams around the player; draws past the authored
          edge only (the seam skips core chunks). One instanced batch. */}
      <VoidShell playerX={player.x} playerZ={player.z} core={core} />
      <Player
        state={props.state}
        animationSeconds={props.animationSeconds}
        moving={props.playerMoving}
        running={props.playerRunning}
      />
    </>
  );
}
