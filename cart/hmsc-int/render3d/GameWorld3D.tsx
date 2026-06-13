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
import { Landform } from './Landform';
import { WaterBodies } from './WaterBody';
import { nearestLandformCameraHit } from '../world/landforms';
import { buildHmscSky } from './sky';

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
}) {
  const world = props.world;
  const sky = useMemo(
    () => buildHmscSky(props.skyConfig.hour, props.skyConfig.weather, props.skyConfig.gloom),
    [props.skyConfig.hour, props.skyConfig.weather, props.skyConfig.gloom],
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
      {/* Registry-driven landforms (mountains, hills, estates): ONE component for
          every kind — a Heightfield mesh baked from the kind's height function,
          tiled with the surface material, plus any kind decoration (crater lake,
          road ribbon). A new terrain shape is one registry entry, zero wiring. */}
      {(world.landforms ?? []).map((landform) => (
        <Landform key={landform.id} landform={landform} />
      ))}
      {/* Bodies of water (world/water): translucent wavy-heightfield volumes at
          each body's level, drawn AFTER the bed so the terrain reads through as
          depth. WaterBodies owns the wave clock, so only the water ripples each
          tick — the static world around it never re-renders. */}
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
      <WorldStatics world={props.state.world} skyConfig={props.state.config.sky} />
      <Player
        state={props.state}
        animationSeconds={props.animationSeconds}
        moving={props.playerMoving}
        running={props.playerRunning}
      />
    </>
  );
}
