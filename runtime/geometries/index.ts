// @reactjit/geometries — the shared registry of 3D geometry generators.
//
// The 3D analog of @reactjit/effects: a geometry generator is the ONE way a shape
// gets into a <Scene3D>. Anything worth reusing (box, sphere, icosphere, terrain)
// lives here ONCE; carts import it by name. The framework knows ZERO shape names —
// it draws interned vertex bytes. See ./README.md.
//
//   import { Box, BOX_DEFAULTS, Sphere, SPHERE_DEFAULTS } from '@reactjit/geometries';
//   <Scene3D.Mesh geometry={Box}    params={BOX_DEFAULTS} material="#2b3326" />
//   <Scene3D.Mesh geometry={Sphere} params={{ ...SPHERE_DEFAULTS, radius: 0.12 }} />

import type { GeometryData } from './_util';
import * as BoxMod from './Box';
import * as SphereMod from './Sphere';
import * as HeadMod from './Head';
import * as CarveMod from './Carve';
import * as GlobeMod from './Globe';
import * as PlaneMod from './Plane';
import * as CylinderMod from './Cylinder';
import * as ConeMod from './Cone';
import * as TorusMod from './Torus';
import * as HeightfieldMod from './Heightfield';
import * as HumanoidMod from './Humanoid';
import * as VoxelMeshMod from './VoxelMesh';

export type { GeometryData, Vec2, Vec3 } from './_util';
// The vertex-assembly kit, so a cart can hand-author its own generator:
//   const Gem = { id: 'gem', defaults: {...}, generate: (p) => { const g = mesh(); … return g.build(); } };
export { mesh, normalize, Mesh } from './_util';

/**
 * A registry entry. `id` is part of the intern hash key — it must be unique and
 * STABLE across builds (changing it invalidates baked blobs). `generate` is a
 * pure params→GeometryData function; `defaults` is the spread-override base.
 */
export type GeometryDef<P = any> = {
  id: string;
  generate: (params: P) => GeometryData;
  defaults: P;
  // A geometry the HOST can regenerate from compact params (vs. shipping baked
  // verts). 'heightfield' = a regular grid the host bakes from the streamed height
  // array (gpu/3d.zig hfGen) — used for live-sculpted terrain so a sculpt ships the
  // cols×rows heights, not ~86k verts. The TS `generate` stays the source of truth
  // for static/baked uses; the host path must stay in parity with it.
  hostKind?: 'heightfield';
};

function def<P>(id: string, generate: (p: P) => GeometryData, defaults: P): GeometryDef<P> {
  return { id, generate, defaults };
}

export const Box = def('Box', BoxMod.generate, BoxMod.BOX_DEFAULTS);
export const Sphere = def('Sphere', SphereMod.generate, SphereMod.SPHERE_DEFAULTS);
// Head — Sphere variant with face-decal UVs (front -Z hemisphere planar, back
// clamped to the decal border). Pair with a face texture via `textureKey`.
export const Head = def('Head', HeadMod.generate, HeadMod.HEAD_DEFAULTS);
// Carve — a piece carved from a flat occupancy mask (image cutout → inflated
// 3D, the Teddy technique). Front/back UVs map the source image onto the piece.
export const Carve = def('Carve', CarveMod.generate, CarveMod.CARVE_DEFAULTS);
// Globe — equirect-unwrapped sphere with a paintable radial displacement grid
// (the head-sculpting base: paint photo + depth on the unwrap, it wraps on).
export const Globe = def('Globe', GlobeMod.generate, GlobeMod.GLOBE_DEFAULTS);
export const Plane = def('Plane', PlaneMod.generate, PlaneMod.PLANE_DEFAULTS);
export const Cylinder = def('Cylinder', CylinderMod.generate, CylinderMod.CYLINDER_DEFAULTS);
export const Cone = def('Cone', ConeMod.generate, ConeMod.CONE_DEFAULTS);
export const Torus = def('Torus', TorusMod.generate, TorusMod.TORUS_DEFAULTS);
// Heightfield has no full defaults (heights/cols/rows are mandatory); callers
// always supply them. defaults here is the partial { width, depth, base, wave, t }.
export const Heightfield: GeometryDef = { ...def('Heightfield', HeightfieldMod.generate, HeightfieldMod.HEIGHTFIELD_DEFAULTS as any), hostKind: 'heightfield' };
// Humanoid — an authored single-mesh low-poly character body (N64/PS1 register).
// Unlike the primitives above, it isn't a math solid — it's one bespoke mesh
// hand-shaped so the figure reads as a body, not a stack of parts.
export const Humanoid = def('Humanoid', HumanoidMod.generate, HumanoidMod.HUMANOID_DEFAULTS);
// VoxelMesh — exposed-face greedy mesh for item blockouts. It is intentionally
// a real mesh generator, not a stack of Box instances, so authored voxel items
// can persist as one shape and sculpt displacement rides the exposed surface.
export const VoxelMesh = def('VoxelMesh', VoxelMeshMod.generate, VoxelMeshMod.VOXEL_MESH_DEFAULTS);

// DEFAULTS re-exports (spread-override friendly: { ...SPHERE_DEFAULTS, radius: 2 }).
export const BOX_DEFAULTS = BoxMod.BOX_DEFAULTS;
export const SPHERE_DEFAULTS = SphereMod.SPHERE_DEFAULTS;
export const HEAD_DEFAULTS = HeadMod.HEAD_DEFAULTS;
export const CARVE_DEFAULTS = CarveMod.CARVE_DEFAULTS;
export const GLOBE_DEFAULTS = GlobeMod.GLOBE_DEFAULTS;
export const PLANE_DEFAULTS = PlaneMod.PLANE_DEFAULTS;
export const CYLINDER_DEFAULTS = CylinderMod.CYLINDER_DEFAULTS;
export const CONE_DEFAULTS = ConeMod.CONE_DEFAULTS;
export const TORUS_DEFAULTS = TorusMod.TORUS_DEFAULTS;
export const HEIGHTFIELD_DEFAULTS = HeightfieldMod.HEIGHTFIELD_DEFAULTS;
export const HUMANOID_DEFAULTS = HumanoidMod.HUMANOID_DEFAULTS;
export const VOXEL_MESH_DEFAULTS = VoxelMeshMod.VOXEL_MESH_DEFAULTS;
// The Humanoid's UV atlas — top-left=head, top-right=arms, bottom-left=torso,
// bottom-right=legs. Painters target a single texture image with those four
// rectangles and the generator's UVs route each body part into its rectangle.
export const HUMANOID_ATLAS = HumanoidMod.HUMANOID_ATLAS;
export const WAVE_NONE = HeightfieldMod.WAVE_NONE;

export type { BoxParams, BoxFace } from './Box';
export type { SphereParams } from './Sphere';
export type { HeadParams } from './Head';
export type { CarveParams } from './Carve';
export type { GlobeParams } from './Globe';
// The Globe's analytic surface evaluator — the same (u,v)→point math generate()
// builds vertices from, exported so tools (the character editor's mesh grab)
// can place handles/ray-pick against EXACTLY the rendered surface.
export { globeSurface } from './Globe';
export type { PlaneParams } from './Plane';
export type { CylinderParams } from './Cylinder';
export type { ConeParams } from './Cone';
export type { TorusParams } from './Torus';
export type { HeightfieldParams, HeightfieldWave } from './Heightfield';
export type { HumanoidParams, UVRect } from './Humanoid';
export type { VoxelMeshParams, VoxelMeshBlock, VoxelMeshStats } from './VoxelMesh';
export { voxelMeshStats } from './VoxelMesh';

/**
 * The registry keyed by id. The bake step serializes a def's `id` + resolved
 * params; the runtime fallback (and any tooling) resolves the def back from its
 * id through this map.
 */
export const GEOMETRIES: Record<string, GeometryDef> = {
  Box, Sphere, Head, Carve, Globe, Plane, Cylinder, Cone, Torus, Heightfield, Humanoid, VoxelMesh,
};
