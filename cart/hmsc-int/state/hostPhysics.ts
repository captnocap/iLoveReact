import type { GameState, SpawnedEntity } from '../design';
import { HOST_VELOCITY_DEADZONE_METERS_PER_SECOND, MOVEMENT_INTENT_DEADZONE, SURFACE_STEP_EPSILON_METERS } from './defaults';
import { tileKindDefinition, type TileKindDefinition, type TileSurfaceProfile } from '../world/tileKinds';
import { tileDefinitionAtWorldPosition } from '../world/grid';
import { placedCellTopMeters, surfaceRegionTopMeters } from '../world/surfaceHeights';
import { roadPhysicsBands, roadTopMeters } from '../world/roads';
import { junctionPhysicsBands, junctionTopMeters } from '../world/roadJunctions';
import { propOrientedPhysicsRect, propPhysicsRect } from '../world/props';
import { propKindDefinition } from '../game/kinds/props';

// Header gained slot 24 = oriented-rect count (after the legacy rect count at 13).
// Bumping this shifts the entity/rect sections consistently because both this
// packer and the host read body offsets off the same constant.
const INPUT_HEADER_FLOATS = 25;
const ENTITY_FLOATS = 8;
// [minX, minZ, maxX, maxZ, top, solid, friction, restitution, floor]. `floor` is
// the bottom of the solid band (host index 8): a rect blocks horizontally only
// while the body overlaps [floor, top]. Walls/roads/props use RECT_SOLID_FLOOR
// (solid to the ground, the old behavior); raised platforms (parking decks, the
// cars on them) carry their real bottom so you walk UNDER them.
const RECT_FLOATS = 9;
// An oriented rect is the same 9-float AABB in the object's OWN un-rotated
// frame, then [pivotX, pivotZ, yawRadians]. Rectangular props and rotated
// structures use these so the host collides them as OBBs (transform the query
// point into the frame, reuse the AABB math, rotate the push back out).
const ORIENTED_FLOATS = 12;
const MAX_ORIENTED = 256;
const OUTPUT_HEADER_FLOATS = 9;
const MAX_ENTITIES = 128;
const MAX_RECTS = 512;
// floor = −∞ sentinel: the rect is solid all the way down, as every rect was
// before banded platforms existed.
const RECT_SOLID_FLOOR = -1e9;
// Below this per-axis delta (meters / m·s⁻¹) the host step counts as "no change",
// so advanceHostPhysics returns the SAME state reference and React bails out of
// the render. Without it, an idle player churns a fresh-but-identical state
// object every 60Hz tick — re-rendering the whole cart, flipping frame_hash, and
// forcing a full 2D GPU re-upload each idle frame (the stutter the perf recorder
// caught). 1e-4 is well under the host's resting jitter and the velocity deadzone.
const IDLE_REST_EPSILON = 1e-4;

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
      RECT_SOLID_FLOOR,
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
      RECT_SOLID_FLOOR,
    );
  }
  // Each road contributes a flat carriageway rect plus a sidewalk rect per side
  // (at most three), carrying that band's friction so the road feels like road
  // and its sidewalks feel like concrete. Roads are always walkable.
  for (const road of state.world.roads) {
    const top = roadTopMeters(road);
    for (const band of roadPhysicsBands(road)) {
      if (rects.length / RECT_FLOATS >= MAX_RECTS) break;
      const tile = tileKindDefinition(band.kind);
      rects.push(
        band.minX,
        band.minZ,
        band.maxX,
        band.maxZ,
        top,
        0,
        tile.surface.friction,
        tile.surface.restitution,
        RECT_SOLID_FLOOR,
      );
    }
  }
  // Each junction is one flat asphalt pad across its footprint, so the player
  // stands on the junction surface that the renderer draws.
  for (const junction of state.world.junctions) {
    const top = junctionTopMeters(junction);
    for (const band of junctionPhysicsBands(junction)) {
      if (rects.length / RECT_FLOATS >= MAX_RECTS) break;
      const tile = tileKindDefinition(band.kind);
      rects.push(
        band.minX,
        band.minZ,
        band.maxX,
        band.maxZ,
        top,
        0,
        tile.surface.friction,
        tile.surface.restitution,
        RECT_SOLID_FLOOR,
      );
    }
  }
  // Each solid prop adds one blocking footprint so the player bumps it.
  // Rectangular props ride the oriented lane below; square/circular props stay
  // here. Non-solid props (bushes) add nothing — they are walk-through.
  for (const prop of state.world.props) {
    if (rects.length / RECT_FLOATS >= MAX_RECTS) break;
    if (propOrientedPhysicsRect(prop)) continue;
    const rect = propPhysicsRect(prop);
    if (!rect) continue;
    const tile = tileKindDefinition(propKindDefinition(prop.kind).tileKind);
    rects.push(
      rect.minX,
      rect.minZ,
      rect.maxX,
      rect.maxZ,
      rect.topMeters,
      1,
      tile.surface.friction,
      tile.surface.restitution,
      RECT_SOLID_FLOOR,
    );
  }
  // Mountains contribute NO rects: they collide as heightfield terrain registered
  // with the host (mountainColliderData → __hmsc_register_heightfield in
  // useMountainColliders), so the host samples the real sloped surface every frame
  // instead of approximating it with flat boxes. See world/mountain.ts.
  return rects;
}

function physicsOrientedRects(state: GameState): number[] {
  const oriented: number[] = [];
  for (const prop of state.world.props) {
    if (oriented.length / ORIENTED_FLOATS >= MAX_ORIENTED) break;
    const rect = propOrientedPhysicsRect(prop);
    if (!rect) continue;
    const tile = tileKindDefinition(propKindDefinition(prop.kind).tileKind);
    oriented.push(
      rect.minX,
      rect.minZ,
      rect.maxX,
      rect.maxZ,
      rect.topMeters,
      1,
      tile.surface.friction,
      tile.surface.restitution,
      RECT_SOLID_FLOOR,
      rect.pivotX,
      rect.pivotZ,
      rect.yawRadians,
    );
  }
  return oriented;
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
  const oriented = physicsOrientedRects(state);
  const input = new Float32Array(INPUT_HEADER_FLOATS + entities.length * ENTITY_FLOATS + rects.length + oriented.length);
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
  // (slot 24 = oriented-rect count, set after the static-config block below)
  input[15] = state.config.physics.jumpSpeedMetersPerSecond;
  input[16] = state.config.physics.playerCapsuleRadiusMeters;
  input[17] = state.config.physics.playerCapsuleHeightMeters;
  input[18] = state.config.physics.wallRestitution;
  input[19] = state.config.physics.bodyRestitution;
  input[20] = state.config.physics.playerStepHeightMeters;
  input[21] = surface.accelerationMultiplier;
  input[22] = surface.friction;
  input[23] = surface.restitution;
  input[24] = oriented.length / ORIENTED_FLOATS;

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
  input.set(oriented, at + rects.length);
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

  // Track whether anything actually moved beyond the idle epsilon. If not, we
  // return the original `state` reference at the end so React skips the render.
  let changed = false;
  const moved = (next: number, prev: number) => Math.abs(next - prev) > IDLE_REST_EPSILON;

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
    if (
      !changed && (
        moved(x, entity.position.x) || moved(y, entity.position.y) || moved(z, entity.position.z) ||
        moved(vx, entity.physics.velocity.x) || moved(vy, entity.physics.velocity.y) || moved(vz, entity.physics.velocity.z) ||
        grounded !== entity.physics.grounded
      )
    ) {
      changed = true;
    }
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

  const playerPosition = { x: output[1] || 0, y: output[2] || 0, z: output[3] || 0 };
  const playerVelocity = { x: output[4] || 0, y: output[5] || 0, z: output[6] || 0 };
  const playerGrounded = (output[7] || 0) > 0;
  if (
    !changed && (
      moved(playerPosition.x, state.player.position.x) || moved(playerPosition.y, state.player.position.y) || moved(playerPosition.z, state.player.position.z) ||
      moved(playerVelocity.x, state.player.physics.velocity.x) || moved(playerVelocity.y, state.player.physics.velocity.y) || moved(playerVelocity.z, state.player.physics.velocity.z) ||
      playerGrounded !== state.player.physics.grounded
    )
  ) {
    changed = true;
  }

  const moving = Math.hypot(playerVelocity.x, playerVelocity.z) > HOST_VELOCITY_DEADZONE_METERS_PER_SECOND || Math.hypot(intentX, intentZ) > MOVEMENT_INTENT_DEADZONE;

  // Nothing moved past the idle epsilon → hand back the SAME state reference so
  // setGameState(prev => prev) bails out and the whole cart skips re-rendering.
  if (!changed) {
    return { state, moving, hostUs: output[0] || 0 };
  }

  return {
    state: {
      ...state,
      player: {
        ...state.player,
        position: playerPosition,
        physics: {
          ...state.player.physics,
          velocity: playerVelocity,
          grounded: playerGrounded,
        },
      },
      world: {
        ...state.world,
        spawnedEntities: nextEntities,
      },
    },
    moving,
    hostUs: output[0] || 0,
  };
}
