import type { GameState, TrafficSignalPhase, Vec3, WorldProp } from '../design';
import { dumpsterBodyMeters, propKindDefinition } from '../game/kinds/props';
import { propModelFootprintMeters } from '../compile/propRecipes/footprint';

// World-layer geometry, queries, and mutations for props — the props twin of
// roads.ts. A prop is anchored at a world-meter point; its collision footprint
// comes from its kind (solid props only), so the player bumps the hydrant/desk
// but walks through the bush. 1 tile = 1 meter.

export type PropFootprint = { minX: number; minZ: number; maxX: number; maxZ: number };
// Half-extents of a prop's footprint plus the model-center OFFSET in the prop's
// own (un-yawed) local frame — nonzero for a body authored off its placement
// anchor (FOOTPRINT-0765). `round` marks a circular base (collide as a circle).
type PropHalfExtents = { halfSpan: number; halfThick: number; offsetX: number; offsetZ: number; round: boolean };

// The collision footprint of a solid prop, sized by its kind's footprint.
// Non-solid props return null — there is nothing to bump.
//
// Rectangular props (fence, jersey barrier, bench, shelf, desk…) are long thin
// shapes spanning along local X, so their AABB depends on yaw. A square would
// block a wide slab around a thin panel — the player stopped walking parallel
// to the fence, or a metre off a shelf face (req_0756). Each such kind carries
// `footprintDepthMeters` on its definition (FOOTPRINT-0756: the ONE footprint
// source the catalog size, placement grid, and physics all read — no more the
// hand-mirrored SEGMENT_HALF_THICKNESS / PROP_DEPTH_OVERRIDES tables that drifted
// fat). Width is `footprintRadiusMeters * 2` (or an explicit footprintWidthMeters);
// depth is the thin axis. Props with no depth field stay a radius-sized square.

// Rotate a prop-LOCAL (un-yawed) offset into world, matching the render/yaw
// convention pieceShapes.localOffset uses (local +z turns toward world +x at
// yaw 90), so the collider tracks the drawn mesh.
function rotateLocalOffset(offsetX: number, offsetZ: number, yawRadians: number): { dx: number; dz: number } {
  const c = Math.cos(yawRadians);
  const s = Math.sin(yawRadians);
  return { dx: offsetX * c + offsetZ * s, dz: -offsetX * s + offsetZ * c };
}

export function propFootprint(prop: WorldProp): PropFootprint | null {
  const extents = propHalfExtents(prop);
  if (!extents) return null;
  const { halfSpan, halfThick, offsetX, offsetZ } = extents;
  const yaw = prop.yawDegrees * Math.PI / 180;
  const center = rotateLocalOffset(offsetX, offsetZ, yaw);
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  const dx = halfSpan * c + halfThick * s;
  const dz = halfSpan * s + halfThick * c;
  const cx = prop.x + center.dx;
  const cz = prop.z + center.dz;
  return { minX: cx - dx, minZ: cz - dz, maxX: cx + dx, maxZ: cz + dz };
}

function propHalfExtents(prop: WorldProp): PropHalfExtents | null {
  const def = propKindDefinition(prop.kind);
  if (!def.solid || def.footprintRadiusMeters <= 0) return null;
  const r = def.footprintRadiusMeters;
  // The dumpster's body is a wide box (width ≠ depth ≠ the radius square) —
  // its half-extents come from the SAME helper both renderers draw with
  // (req_0623: the player clipped into the widened body because physics
  // still used the footprint square).
  if (prop.kind === 'dumpster') {
    const body = dumpsterBodyMeters();
    return { halfSpan: body.widthMeters / 2, halfThick: body.depthMeters / 2, offsetX: 0, offsetZ: 0, round: false };
  }
  // FOOTPRINT-0759/0765: a data-recipe prop's footprint is MEASURED from its
  // model (exact, no magic number) — width/depth span, the model-center offset
  // (so an off-center body tracks under rotation), and a round flag. Bespoke
  // (TSX) props have no recipe → their measured footprintDepthMeters field;
  // props with neither stay a radius square. Width defaults to r*2.
  const model = propModelFootprintMeters(prop.kind);
  if (model) {
    return { halfSpan: model.widthMeters / 2, halfThick: model.depthMeters / 2, offsetX: model.offsetXMeters, offsetZ: model.offsetZMeters, round: model.round };
  }
  if (def.footprintDepthMeters !== undefined) {
    return { halfSpan: (def.footprintWidthMeters ?? r * 2) / 2, halfThick: def.footprintDepthMeters / 2, offsetX: 0, offsetZ: 0, round: false };
  }
  return { halfSpan: r, halfThick: r, offsetX: 0, offsetZ: 0, round: false };
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
export type PropOrientedPhysicsRect = PropPhysicsRect & { pivotX: number; pivotZ: number; yawRadians: number };

export function propPhysicsRect(prop: WorldProp): PropPhysicsRect | null {
  const footprint = propFootprint(prop);
  if (!footprint) return null;
  return { ...footprint, topMeters: propTopMeters(prop) };
}

// The exact host-physics OBB for rectangular prop footprints. `propFootprint`
// stays an AABB for editor selection/overlap scans; physics should use this
// where an oriented-rect lane is available so a rotated desk/fence does not
// fall back to a radius-sized or AABB-sized air wall.
export function propOrientedPhysicsRect(prop: WorldProp): PropOrientedPhysicsRect | null {
  const extents = propHalfExtents(prop);
  if (!extents) return null;
  // A centered square needs no oriented lane (its axis rect is rotation-proof);
  // anything non-square OR off-center (the offset must orbit the pivot with yaw)
  // rides the oriented rect. The rect is the footprint in the prop's LOCAL frame
  // positioned at the anchor (pivot); the host rotates the player into it.
  const offCenter = Math.abs(extents.offsetX) > 1e-6 || Math.abs(extents.offsetZ) > 1e-6;
  if (Math.abs(extents.halfSpan - extents.halfThick) < 1e-6 && !offCenter) return null;
  return {
    minX: prop.x + extents.offsetX - extents.halfSpan,
    minZ: prop.z + extents.offsetZ - extents.halfThick,
    maxX: prop.x + extents.offsetX + extents.halfSpan,
    maxZ: prop.z + extents.offsetZ + extents.halfThick,
    topMeters: propTopMeters(prop),
    pivotX: prop.x,
    pivotZ: prop.z,
    yawRadians: prop.yawDegrees * Math.PI / 180,
  };
}

// The prop the player is currently standing inside, if any — used to fold a
// bush's concealment/foliage tile into gameplay queries (the player ducking
// into a shrub). Last placed wins, mirroring the road/junction lookups.
export function propAtWorldPosition(state: GameState, position: Vec3): WorldProp | undefined {
  for (let index = state.world.props.length - 1; index >= 0; index -= 1) {
    const prop = state.world.props[index];
    const def = propKindDefinition(prop.kind);
    const solidFootprint = def.solid ? propFootprint(prop) : null;
    if (solidFootprint) {
      if (footprintContains(solidFootprint, position.x, position.z)) return prop;
      continue;
    }
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
