import type { GameState, Landform, LandformField, TileKind, Vec3 } from '../../design';
import { bakeTerrainField, terrainColliderData, type TerrainColliderData, type TerrainField } from '../terrain';

// THE landform registry — the terrain twin of tileKinds/propKinds/buildingKinds.
// A placed landform is pure DATA ({ kind, center, baseY, params }, type in
// design.ts); its shape, footing, look, and any decorations are resolved by `kind`
// through LANDFORMS, so every consumer (render, collider, camera, ground/footing
// queries, seed) iterates ONE `world.landforms` array and looks the kind up here.
// A new landform = register one kind (a height function + a surface tile kind),
// with ZERO new wiring. The framework knows zero landform names. 1 tile = 1 meter.

export type LandformKindDef = {
  kind: string;
  defaults: Record<string, number>;
  // Height above baseY at LOCAL (x,z) relative to the landform center — the height
  // function (cone, dome, bumps, …). The only thing that really differs per kind.
  // `field` is the landform's optional baked grid; a parametric kind ignores it, a
  // painted ('heightfield') kind bilinearly samples it.
  rise: (params: Record<string, number>, localX: number, localZ: number, field?: LandformField) => number;
  // Bounding footprint radius (bake half-width, culling, query early-outs). A
  // field-backed kind derives it from the grid extent.
  footprintRadius: (params: Record<string, number>, field?: LandformField) => number;
  // cos(slope limit): surfaces flatter than this are walkable, steeper are walls.
  walkCos: (params: Record<string, number>) => number;
  // Mesh + collider grid resolution (cols == rows). A constant for parametric
  // kinds; a field-backed kind returns its grid's column count so the bake samples
  // grid points exactly (no resampling blur).
  resolution: number | ((field?: LandformField) => number);
  // The surface's tile material — the landform tiles this kind across its surface
  // by world-XZ (the flat ground's exact tile material, draped over the height),
  // and it is the footing the player reads on it.
  surfaceTileKind: (params: Record<string, number>) => TileKind;
  // How the surface is painted (render-only; footing stays surfaceTileKind):
  //   0 = plain tiled tile-material (the bare ground material), default
  //   1 = natural terrain blend — sand base + grass patches + rock outcrops,
  //       still tiled with slab joints (so a 'sand' hill isn't one giant dune).
  //   2 = rock-dominant (mountain flank), 3 = manicured lawn (estate dome).
  // See render3d/landformFill.ts. Default 0.
  surfaceStyle?: (params: Record<string, number>) => number;
  // Footing override for a sub-region of the surface (the carved trail on a
  // mountain, the road on an estate): returns the footing tile when (localX,
  // localZ) lies on that region, else undefined to fall back to surfaceTileKind.
  // Local coords are relative to the landform center. This is how one landform
  // carries two footings (a road you drive vs. the lawn beside it) without
  // forcing every kind to be position-aware.
  surfaceFootingAt?: (params: Record<string, number>, localX: number, localZ: number) => TileKind | undefined;
  // Whether a point is submerged in this landform's standing water (a crater
  // lake), given the point's world Y and the landform's baseY. Drives the 'water'
  // wade footing. Local coords are relative to center. Omitted = no water.
  submergedAt?: (params: Record<string, number>, localX: number, localZ: number, worldY: number, baseY: number) => boolean;
};

export const LANDFORMS: Record<string, LandformKindDef> = {};

export function registerLandformKind(def: LandformKindDef): void {
  LANDFORMS[def.kind] = def;
}

export function landformKindDef(kind: string): LandformKindDef | undefined {
  return LANDFORMS[kind];
}

// World-space surface height under a point (raw mesh surface, any slope).
export function landformSurfaceTop(lf: Landform, x: number, z: number): number {
  const def = LANDFORMS[lf.kind];
  if (!def) return lf.baseY;
  return lf.baseY + def.rise(lf.params, x - lf.centerX, z - lf.centerZ, lf.field);
}

// Up-normal Y of the surface at a point (central difference of the rise) — the
// generic walkable/wall test the host's slope limit uses.
function surfaceNormalY(lf: Landform, def: LandformKindDef, x: number, z: number): number {
  const e = 0.5;
  const lx = x - lf.centerX;
  const lz = z - lf.centerZ;
  const dhdx = (def.rise(lf.params, lx + e, lz, lf.field) - def.rise(lf.params, lx - e, lz, lf.field)) / (2 * e);
  const dhdz = (def.rise(lf.params, lx, lz + e, lf.field) - def.rise(lf.params, lx, lz - e, lf.field)) / (2 * e);
  return 1 / Math.sqrt(dhdx * dhdx + 1 + dhdz * dhdz);
}

// The baked height grid (mesh + collider), via the shared terrain bake.
export function landformHeightfield(lf: Landform): TerrainField {
  const def = LANDFORMS[lf.kind];
  if (!def) throw new Error(`unknown landform kind ${lf.kind}`);
  return bakeTerrainField({
    centerX: lf.centerX,
    centerZ: lf.centerZ,
    baseY: lf.baseY,
    halfWidth: def.footprintRadius(lf.params, lf.field),
    resolution: typeof def.resolution === 'function' ? def.resolution(lf.field) : def.resolution,
    walkCos: def.walkCos(lf.params),
    rise: (x, z) => def.rise(lf.params, x - lf.centerX, z - lf.centerZ, lf.field),
  });
}

export function landformColliderData(lf: Landform): TerrainColliderData {
  return terrainColliderData(landformHeightfield(lf));
}

// --- Shared queries over state.world.landforms (resolve each via the registry) ---

// Walkable ground top under a point (spawn/teleport/pathing; live collision is the
// host's). Reports the surface only where it's WALKABLE (slope under the kind's
// limit) — steep faces are walls, left to the other ground sources.
export function landformTopAtWorldPosition(state: GameState, position: Vec3, maxReachableTop: number): number | undefined {
  let top: number | undefined;
  for (const lf of state.world.landforms ?? []) {
    const def = LANDFORMS[lf.kind];
    if (!def) continue;
    if (Math.hypot(position.x - lf.centerX, position.z - lf.centerZ) > def.footprintRadius(lf.params, lf.field)) continue;
    if (surfaceNormalY(lf, def, position.x, position.z) < def.walkCos(lf.params)) continue;
    const surface = landformSurfaceTop(lf, position.x, position.z);
    if (surface > maxReachableTop) continue;
    top = top == null ? surface : Math.max(top, surface);
  }
  return top;
}

// The footing the player reads when standing on a landform surface (gait/friction
// /noise) — the kind's region footing (the trail/road) where one applies, else its
// surface tile, when feet rest on it.
export function landformTileKindAtWorldPosition(state: GameState, position: Vec3): TileKind | undefined {
  const STANDING_TOLERANCE_METERS = 0.6;
  for (const lf of state.world.landforms ?? []) {
    const def = LANDFORMS[lf.kind];
    if (!def) continue;
    if (Math.hypot(position.x - lf.centerX, position.z - lf.centerZ) > def.footprintRadius(lf.params, lf.field)) continue;
    if (Math.abs(landformSurfaceTop(lf, position.x, position.z) - position.y) <= STANDING_TOLERANCE_METERS) {
      const lx = position.x - lf.centerX;
      const lz = position.z - lf.centerZ;
      return def.surfaceFootingAt?.(lf.params, lx, lz) ?? def.surfaceTileKind(lf.params);
    }
  }
  return undefined;
}

// 'water' footing when the player wades in a landform's standing water (a crater
// lake). Overrides the surface footing (you're in the water, not on the bed).
// The host still walks the player on the bed (the heightfield); this only changes
// how moving through the water feels. Replaces the old mountainWaterKind query.
export function landformWaterKindAtWorldPosition(state: GameState, position: Vec3): TileKind | undefined {
  for (const lf of state.world.landforms ?? []) {
    const def = LANDFORMS[lf.kind];
    if (!def?.submergedAt) continue;
    if (def.submergedAt(lf.params, position.x - lf.centerX, position.z - lf.centerZ, position.y, lf.baseY)) {
      return 'water';
    }
  }
  return undefined;
}

// --- Raw surface top + camera collision ---

// The raw landform surface top under a point — the max over every landform whose
// footprint covers it, with NO walkable gate (unlike landformTopAtWorldPosition,
// which reports only walkable ground). This is what an object PLACED on the
// terrain rests on (a building pad, a prop's foot) and what the camera collides
// with. undefined where no landform covers the point (flat ground sits at baseY).
export function landformGroundTopAt(state: GameState, x: number, z: number): number | undefined {
  let top: number | undefined;
  for (const lf of state.world.landforms ?? []) {
    const def = LANDFORMS[lf.kind];
    if (!def) continue;
    if (Math.hypot(x - lf.centerX, z - lf.centerZ) >= def.footprintRadius(lf.params, lf.field)) continue;
    const surface = landformSurfaceTop(lf, x, z);
    top = top == null ? surface : Math.max(top, surface);
  }
  return top;
}

export function nearestLandformCameraHit(state: GameState, from: Vec3, to: Vec3): number {
  const STEPS = 24;
  for (let i = 1; i <= STEPS; i += 1) {
    const t = i / STEPS;
    const y = from.y + (to.y - from.y) * t;
    const surface = landformGroundTopAt(state, from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t);
    if (surface != null && y < surface) return t;
  }
  return 1;
}

// --- Mutations ---

export function placeLandform(state: GameState, landform: Landform): GameState {
  return { ...state, world: { ...state.world, landforms: [...(state.world.landforms ?? []), landform] } };
}

export function removeLandform(state: GameState, id: string): GameState {
  return { ...state, world: { ...state.world, landforms: (state.world.landforms ?? []).filter((l) => l.id !== id) } };
}
