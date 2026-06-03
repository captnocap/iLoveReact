import type { GameState, TrafficSignalPhase, Vec3, WorldProp } from '../design';
import { propKindDefinition } from './propKinds';

// World-layer geometry, queries, and mutations for props — the props twin of
// roads.ts. A prop is anchored at a world-meter point; its collision is a small
// axis-aligned square around that anchor (solid props only), so the player
// bumps the hydrant but walks through the bush. 1 tile = 1 meter.

export type PropFootprint = { minX: number; minZ: number; maxX: number; maxZ: number };

// The collision footprint of a solid prop, sized by its kind's radius.
// Non-solid props return null — there is nothing to bump.
//
// Fences are a special case: they are long thin segments (spanning along local X),
// so their axis-aligned bounding box depends on yaw. A square would block a 2.7 m
// slab around a 0.08 m thick panel — the player would be stopped walking parallel
// to the fence. The AABB of a rotated rectangle gives a thin box that follows the
// actual mesh.
export function propFootprint(prop: WorldProp): PropFootprint | null {
  const def = propKindDefinition(prop.kind);
  if (!def.solid || def.footprintRadiusMeters <= 0) return null;
  const r = def.footprintRadiusMeters;
  if (prop.kind !== 'fence') {
    return { minX: prop.x - r, minZ: prop.z - r, maxX: prop.x + r, maxZ: prop.z + r };
  }
  // Fence: long thin segment. halfSpan = the segment half-width (along local X);
  // halfThick = the post diameter (~0.08 m). The AABB of a rotated rectangle.
  const halfSpan = r;
  const halfThick = 0.08;
  const yaw = prop.yawDegrees * Math.PI / 180;
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  const dx = halfSpan * c + halfThick * s;
  const dz = halfSpan * s + halfThick * c;
  return { minX: prop.x - dx, minZ: prop.z - dz, maxX: prop.x + dx, maxZ: prop.z + dz };
}

export function propTopMeters(prop: WorldProp): number {
  return prop.y + propKindDefinition(prop.kind).heightMeters;
}

function footprintContains(footprint: PropFootprint, x: number, z: number): boolean {
  return x >= footprint.minX && x < footprint.maxX && z >= footprint.minZ && z < footprint.maxZ;
}

// A blocking rect for a solid prop, in the same shape host physics packs for
// road/junction bands: [minX, minZ, maxX, maxZ, top]. topMeters is the TOP of
// the prop (ground prop.y + the kind's full height), NOT the ground it stands
// on. The host reads rect[4] as the box top: it collides with the sides while
// the player's feet are below it and lets you stand on it once above. With
// topMeters = prop.y the box was zero-height, so the player (feet ~ground) was
// always "above" it (the `y >= rect_height - 0.04` skip in hmscCollideSolidRects)
// and walked through. Using the real height makes poles/signs/hydrants solid.
export type PropPhysicsRect = PropFootprint & { topMeters: number };

export function propPhysicsRect(prop: WorldProp): PropPhysicsRect | null {
  const footprint = propFootprint(prop);
  if (!footprint) return null;
  return { ...footprint, topMeters: propTopMeters(prop) };
}

// The prop the player is currently standing inside, if any — used to fold a
// bush's concealment/foliage tile into gameplay queries (the player ducking
// into a shrub). Last placed wins, mirroring the road/junction lookups.
export function propAtWorldPosition(state: GameState, position: Vec3): WorldProp | undefined {
  for (let index = state.world.props.length - 1; index >= 0; index -= 1) {
    const prop = state.world.props[index];
    const def = propKindDefinition(prop.kind);
    const radius = def.solid ? def.footprintRadiusMeters : Math.max(def.footprintRadiusMeters, 0.6);
    if (radius <= 0) continue;
    const footprint: PropFootprint = { minX: prop.x - radius, minZ: prop.z - radius, maxX: prop.x + radius, maxZ: prop.z + radius };
    if (footprintContains(footprint, position.x, position.z)) return prop;
  }
  return undefined;
}

// --- Mutations (immutable, mirror roads.ts placeRoad/removeRoad) ---

export function placeProp(state: GameState, prop: WorldProp): GameState {
  return { ...state, world: { ...state.world, props: [...state.world.props, prop] } };
}

export function removeProp(state: GameState, propId: string): GameState {
  return { ...state, world: { ...state.world, props: state.world.props.filter((prop) => prop.id !== propId) } };
}

export function setPropSignalOverride(state: GameState, propId: string, phase: TrafficSignalPhase | null): GameState {
  return {
    ...state,
    world: {
      ...state.world,
      props: state.world.props.map((prop) => {
        if (prop.id !== propId) return prop;
        if (phase == null) {
          const { signalOverride: _drop, ...rest } = prop;
          return rest;
        }
        return { ...prop, signalOverride: phase };
      }),
    },
  };
}
