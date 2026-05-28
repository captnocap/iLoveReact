import { Scene3D } from '@reactjit/runtime/primitives';
import * as Geometry from '@reactjit/geometries';
import type { GameState, PlacedCell, SpawnedEntity, TileKind, WorldSurfaceRegion } from '../design';
import { HMSC_GAMEPLAY_CAMERA } from '../gameplay/camera';
import { tileKindDefinition } from '../world/tileKinds';
import { surfaceRegionTopMeters } from '../world/surfaceHeights';
import { PlayerFigure } from './PlayerFigure';
import { buildHmscSky } from './sky';

type WorldMeshRect = {
  key: string;
  kind: TileKind;
  x: number;
  y: number;
  z: number;
  width: number;
  depth: number;
};

function rectMeshPosition(rect: WorldMeshRect, height: number): [number, number, number] {
  return [
    rect.x + rect.width / 2,
    rect.y + height / 2,
    rect.z + rect.depth / 2,
  ];
}

function occupancyKey(x: number, z: number): string {
  return `${x},${z}`;
}

function coalesceCellsIntoWorldRects(placedCells: PlacedCell[]): WorldMeshRect[] {
  const groups = new Map<string, PlacedCell[]>();
  for (const placedCell of placedCells) {
    const groupKey = `${placedCell.kind}:${placedCell.cell.y}`;
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), placedCell]);
  }

  const rects: WorldMeshRect[] = [];
  for (const cells of groups.values()) {
    const remaining = new Map<string, PlacedCell>();
    for (const placedCell of cells) remaining.set(occupancyKey(placedCell.cell.x, placedCell.cell.z), placedCell);

    while (remaining.size > 0) {
      const origin = [...remaining.values()].sort((a, b) => (
        a.cell.z === b.cell.z ? a.cell.x - b.cell.x : a.cell.z - b.cell.z
      ))[0];

      let width = 1;
      while (remaining.has(occupancyKey(origin.cell.x + width, origin.cell.z))) width += 1;

      let depth = 1;
      let canGrowDepth = true;
      while (canGrowDepth) {
        const nextZ = origin.cell.z + depth;
        for (let dx = 0; dx < width; dx += 1) {
          if (!remaining.has(occupancyKey(origin.cell.x + dx, nextZ))) {
            canGrowDepth = false;
            break;
          }
        }
        if (canGrowDepth) depth += 1;
      }

      for (let dz = 0; dz < depth; dz += 1) {
        for (let dx = 0; dx < width; dx += 1) {
          remaining.delete(occupancyKey(origin.cell.x + dx, origin.cell.z + dz));
        }
      }

      rects.push({
        key: `${origin.kind}:${origin.cell.y}:${origin.cell.x},${origin.cell.z}:${width}x${depth}`,
        kind: origin.kind,
        x: origin.cell.x,
        y: origin.cell.y,
        z: origin.cell.z,
        width,
        depth,
      });
    }
  }

  return rects;
}

function MapRectMesh(props: { rect: WorldMeshRect }) {
  const style = tileKindDefinition(props.rect.kind).render;
  return (
    <Scene3D.Mesh
      geometry={Geometry.Box}
      params={{ width: props.rect.width, height: style.heightMeters, depth: props.rect.depth }}
      material={style.textureKey ? '#ffffff' : style.color}
      textureKey={style.textureKey}
      position={rectMeshPosition(props.rect, style.heightMeters)}
    />
  );
}

function SurfaceRegionMesh(props: { region: WorldSurfaceRegion; cellSizeMeters: number }) {
  const style = tileKindDefinition(props.region.kind).render;
  const widthMeters = props.region.width * props.cellSizeMeters;
  const depthMeters = props.region.depth * props.cellSizeMeters;
  const topMeters = surfaceRegionTopMeters(props.region, props.cellSizeMeters);
  return (
    <Scene3D.Mesh
      geometry={Geometry.Box}
      params={{ width: widthMeters, height: style.heightMeters, depth: depthMeters }}
      material={style.textureKey ? '#ffffff' : style.color}
      textureKey={style.textureKey}
      position={[
        props.region.x * props.cellSizeMeters + widthMeters / 2,
        topMeters - style.heightMeters / 2,
        props.region.z * props.cellSizeMeters + depthMeters / 2,
      ]}
    />
  );
}

function SpawnedEntityMesh(props: { entity: SpawnedEntity }) {
  const entity = props.entity;
  const radius = entity.physics?.radiusMeters ?? 0.28;
  const position: [number, number, number] = [entity.position.x, entity.position.y, entity.position.z];
  if (/crate|box/i.test(entity.kind)) {
    const side = radius * 1.75;
    return (
      <Scene3D.Mesh
        geometry={Geometry.Box}
        params={{ width: side, height: side, depth: side }}
        material="#d97745"
        position={position}
        rotation={[entity.yawDegrees, entity.yawDegrees * 0.37, 0]}
      />
    );
  }
  if (/can|barrel/i.test(entity.kind)) {
    return (
      <Scene3D.Mesh
        geometry={Geometry.Cylinder}
        params={{ radius, height: radius * 2.2, segments: 18 }}
        material="#60a5fa"
        position={position}
        rotation={[0, entity.yawDegrees, 0]}
      />
    );
  }
  return (
    <Scene3D.Mesh
      geometry={Geometry.Sphere}
      params={{ radius }}
      material={/ball|sphere/i.test(entity.kind) ? '#facc15' : '#a78bfa'}
      position={position}
    />
  );
}

export function GameWorld3D(props: {
  state: GameState;
  animationSeconds: number;
  playerMoving: boolean;
  playerRunning: boolean;
  cameraYawDegrees: number;
  cameraPitchRadians: number;
  aiming?: boolean;
  sceneChildren?: any;
}) {
  const state = props.state;
  const placedCells = Object.values(state.world.placedCells);
  const surfaceRegions = state.world.surfaceRegions;
  const spawnedEntities = Object.values(state.world.spawnedEntities);
  const worldRects = coalesceCellsIntoWorldRects(placedCells);
  const sky = buildHmscSky(state.config.sky.hour, state.config.sky.weather, state.config.sky.gloom);
  const player = state.player.position;
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

  return (
    <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={sky.ground} showGrid={false} showAxes={false}>
      <Scene3D.Camera position={cameraPosition} target={cameraTarget} fov={props.aiming ? HMSC_GAMEPLAY_CAMERA.aimFovDegrees : HMSC_GAMEPLAY_CAMERA.fovDegrees} />
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
      <Scene3D.AmbientLight color={sky.horizon} intensity={sky.ambient} />
      <Scene3D.DirectionalLight direction={sky.sunDir} color={sky.lightColor} intensity={sky.lightIntensity} />
      <Scene3D.DirectionalLight direction={[-0.25, 0.74, -0.45]} color="#8fb8ff" intensity={sky.night * 0.32} />
      <Scene3D.PointLight position={cameraPosition} color="#9edcff" intensity={0.38 + sky.night * 0.32} />
      <Scene3D.PointLight position={[player.x + 1.8, player.y + 3.2, player.z + 1.4]} color="#ffd2a3" intensity={0.18 + sky.night * 0.18} />
      {surfaceRegions.length === 0 ? (
        <Scene3D.Mesh
          geometry={Geometry.Box}
          params={{ width: 28, height: 0.04, depth: 22 }}
          material="#0d1320"
          position={[0.5, -0.03, 0.5]}
        />
      ) : null}
      {surfaceRegions.map((region) => (
        <SurfaceRegionMesh key={region.id} region={region} cellSizeMeters={state.world.cellSizeMeters} />
      ))}
      {worldRects.map((rect) => (
        <MapRectMesh key={rect.key} rect={rect} />
      ))}
      {spawnedEntities.map((entity) => (
        <SpawnedEntityMesh key={entity.id} entity={entity} />
      ))}
      {props.sceneChildren}
      <PlayerFigure
        position={player}
        yawDegrees={state.player.yawDegrees}
        animationSeconds={props.animationSeconds}
        moving={props.playerMoving}
        running={props.playerRunning}
      />
    </Scene3D>
  );
}
