import type { GameState, SpawnedEntity } from '../design';
import { HOST_VELOCITY_DEADZONE_METERS_PER_SECOND, MOVEMENT_INTENT_DEADZONE, SURFACE_STEP_EPSILON_METERS } from './defaults';
import { tileKindDefinition, type TileKindDefinition, type TileSurfaceProfile } from '../world/tileKinds';
import { tileDefinitionAtWorldPosition } from '../world/grid';
import { placedCellTopMeters, surfaceRegionTopMeters } from '../world/surfaceHeights';

const INPUT_HEADER_FLOATS = 24;
const ENTITY_FLOATS = 8;
const RECT_FLOATS = 8;
const OUTPUT_HEADER_FLOATS = 9;
const MAX_ENTITIES = 128;
const MAX_RECTS = 512;

type HostPhysicsResult = {
  state: GameState;
  moving: boolean;
  hostUs: number;
};

export type MovementSurface = {
  speedMultiplier: number;
  accelerationMultiplier: number;
  friction: number;
  restitution: number;
  label: string;
};

function tileDefinitionBelowPlayer(state: GameState): TileKindDefinition {
  const terrainTile = tileDefinitionAtWorldPosition(state, state.player.position);
  const cellSize = state.world.cellSizeMeters;
  const cellX = Math.floor(state.player.position.x / cellSize);
  const cellZ = Math.floor(state.player.position.z / cellSize);
  const maxTop = state.player.position.y + state.config.physics.playerStepHeightMeters + SURFACE_STEP_EPSILON_METERS;
  let bestTop = -Infinity;
  let bestTile: TileKindDefinition | undefined;

  for (const placedCell of Object.values(state.world.placedCells)) {
    if (placedCell.cell.x !== cellX || placedCell.cell.z !== cellZ) continue;
    const tile = tileKindDefinition(placedCell.kind);
    const top = placedCell.cell.y + tile.render.heightMeters;
    if (top <= maxTop && top >= bestTop) {
      bestTop = top;
      bestTile = tile;
    }
  }

  return bestTile ?? terrainTile ?? tileKindDefinition('road');
}

declare const globalThis: any;

function hostPhysicsStep(input: Float32Array): ArrayBuffer | null {
  const fn = globalThis.__hmsc_physics_step;
  if (typeof fn !== 'function') return null;
  const result = fn(input);
  return result && typeof result.byteLength === 'number' ? result : null;
}

function sortedPhysicsEntities(state: GameState): SpawnedEntity[] {
  return Object.values(state.world.spawnedEntities)
    .filter((entity) => entity.physics?.enabled)
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, MAX_ENTITIES);
}

function physicsRects(state: GameState): number[] {
  const cellSize = state.world.cellSizeMeters;
  const rects: number[] = [];
  for (const region of state.world.surfaceRegions) {
    if (rects.length / RECT_FLOATS >= MAX_RECTS) break;
    const tile = tileKindDefinition(region.kind);
    const blocksPlayer = tile.surface.material !== 'water' && !tile.pathing.walkable;
    const minX = region.x * cellSize;
    const minZ = region.z * cellSize;
    rects.push(
      minX,
      minZ,
      minX + region.width * cellSize,
      minZ + region.depth * cellSize,
      surfaceRegionTopMeters(region, cellSize),
      blocksPlayer ? 1 : 0,
      tile.surface.friction,
      tile.surface.restitution,
    );
  }
  for (const placedCell of Object.values(state.world.placedCells)) {
    if (rects.length / RECT_FLOATS >= MAX_RECTS) break;
    const tile = tileKindDefinition(placedCell.kind);
    const blocksPlayer = tile.surface.material !== 'water' && !tile.pathing.walkable;
    const minX = placedCell.cell.x * cellSize;
    const minZ = placedCell.cell.z * cellSize;
    rects.push(
      minX,
      minZ,
      minX + cellSize,
      minZ + cellSize,
      placedCellTopMeters(placedCell, cellSize),
      blocksPlayer ? 1 : 0,
      tile.surface.friction,
      tile.surface.restitution,
    );
  }
  return rects;
}

export function movementSurfaceForPlayer(state: GameState, running: boolean): MovementSurface {
  const tile = tileDefinitionBelowPlayer(state);
  const surface = tile.surface;
  return {
    speedMultiplier: running ? surface.runSpeedMultiplier : surface.walkSpeedMultiplier,
    accelerationMultiplier: surface.accelerationMultiplier,
    friction: surface.friction,
    restitution: surface.restitution,
    label: tile.label,
  };
}

function makeInput(
  state: GameState,
  dt: number,
  intentX: number,
  intentZ: number,
  speed: number,
  jumpDown: boolean,
  surface: Pick<TileSurfaceProfile, 'accelerationMultiplier' | 'friction' | 'restitution'>,
): { input: Float32Array; entities: SpawnedEntity[] } {
  const entities = sortedPhysicsEntities(state);
  const rects = physicsRects(state);
  const input = new Float32Array(INPUT_HEADER_FLOATS + entities.length * ENTITY_FLOATS + rects.length);
  const player = state.player;
  input[0] = dt;
  input[1] = intentX;
  input[2] = intentZ;
  input[3] = speed;
  input[4] = jumpDown ? 1 : 0;
  input[5] = player.position.x;
  input[6] = player.position.y;
  input[7] = player.position.z;
  input[8] = player.physics.velocity.x;
  input[9] = player.physics.velocity.y;
  input[10] = player.physics.velocity.z;
  input[11] = player.yawDegrees;
  input[12] = entities.length;
  input[13] = rects.length / RECT_FLOATS;
  input[14] = state.config.physics.gravityMetersPerSecondSquared;
  input[15] = state.config.physics.jumpSpeedMetersPerSecond;
  input[16] = state.config.physics.playerCapsuleRadiusMeters;
  input[17] = state.config.physics.playerCapsuleHeightMeters;
  input[18] = state.config.physics.wallRestitution;
  input[19] = state.config.physics.bodyRestitution;
  input[20] = state.config.physics.playerStepHeightMeters;
  input[21] = surface.accelerationMultiplier;
  input[22] = surface.friction;
  input[23] = surface.restitution;

  let at = INPUT_HEADER_FLOATS;
  for (const entity of entities) {
    const physics = entity.physics;
    input[at++] = entity.position.x;
    input[at++] = entity.position.y;
    input[at++] = entity.position.z;
    input[at++] = physics.velocity.x;
    input[at++] = physics.velocity.y;
    input[at++] = physics.velocity.z;
    input[at++] = physics.radiusMeters;
    input[at++] = physics.restitution;
  }
  input.set(rects, at);
  return { input, entities };
}

export function advanceHostPhysics(
  state: GameState,
  dt: number,
  intentX: number,
  intentZ: number,
  speed: number,
  jumpDown: boolean,
  accelerationMultiplier = 1,
  friction = 0.2,
  restitution = 0.8,
): HostPhysicsResult | null {
  const { input, entities } = makeInput(
    state,
    dt,
    intentX,
    intentZ,
    speed,
    jumpDown,
    { accelerationMultiplier, friction, restitution },
  );
  const buffer = hostPhysicsStep(input);
  if (!buffer) return null;
  const output = new Float32Array(buffer);
  const count = Math.min(entities.length, Math.max(0, Math.floor(output[8] || 0)));
  if (output.length < OUTPUT_HEADER_FLOATS + count * ENTITY_FLOATS) return null;

  const nextEntities = { ...state.world.spawnedEntities };
  let at = OUTPUT_HEADER_FLOATS;
  for (let i = 0; i < count; i += 1) {
    const entity = entities[i];
    const x = output[at++];
    const y = output[at++];
    const z = output[at++];
    const vx = output[at++];
    const vy = output[at++];
    const vz = output[at++];
    const radius = output[at++] || entity.physics.radiusMeters;
    const grounded = (output[at++] || 0) > 0;
    nextEntities[entity.id] = {
      ...entity,
      position: { x, y, z },
      physics: {
        ...entity.physics,
        radiusMeters: radius,
        velocity: { x: vx, y: vy, z: vz },
        grounded,
      },
    };
  }

  const playerVelocity = { x: output[4] || 0, y: output[5] || 0, z: output[6] || 0 };
  return {
    state: {
      ...state,
      player: {
        ...state.player,
        position: { x: output[1] || 0, y: output[2] || 0, z: output[3] || 0 },
        physics: {
          ...state.player.physics,
          velocity: playerVelocity,
          grounded: (output[7] || 0) > 0,
        },
      },
      world: {
        ...state.world,
        spawnedEntities: nextEntities,
      },
    },
    moving: Math.hypot(playerVelocity.x, playerVelocity.z) > HOST_VELOCITY_DEADZONE_METERS_PER_SECOND || Math.hypot(intentX, intentZ) > MOVEMENT_INTENT_DEADZONE,
    hostUs: output[0] || 0,
  };
}
