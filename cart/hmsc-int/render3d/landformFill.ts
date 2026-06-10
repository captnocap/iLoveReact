import type { Landform } from '../design';
import { landformKindDef } from '../world/landforms';
import { TILE_FILL_WGSL } from './tileFill';
import { tileFillMaterialId, tileFillVariant } from './tileFill';

// A landform's surface, TILED exactly like the flat ground: reconstruct the world
// cell from the planar UV (1 tile = 1 m) and run a per-cell material + slab joint,
// draped over the height. So a hill reads as the same 1 m tile grid as the ground
// (RuneScape-style — top-down tiling, stretches a bit on steep faces, expected).
//
// surfaceStyle (D[5]):
//   0 = plain tiled tile-material (the bare ground material via tileMaterial)
//   1 = NATURAL TERRAIN — a sand base with smooth grass patches + rock outcrops
//       (low-freq world noise), still per-cell varied + joint-cut, so a 'sand'
//       hill reads as natural hills, not one giant dune.
//   2 = ROCK — a rock/scree flank with sparse dry-grass tufts (the mountain).
//   3 = LAWN — manicured green with gentle mottle + a few shrubs (the estate).
// D: [footprintWidth, originX, originZ, materialId, variant, surfaceStyle]
export const LANDFORM_FILL_SHADER = `
@group(0) @binding(1) var<storage, read> D: array<f32>;
${TILE_FILL_WGSL}
fn lf_vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let a = tf_rand(i);
  let b = tf_rand(i + vec2f(1.0, 0.0));
  let c = tf_rand(i + vec2f(0.0, 1.0));
  let d = tf_rand(i + vec2f(1.0, 1.0));
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
fn lf_natural(cell: vec2f, cellSeed: f32) -> vec3f {
  let sand = vec3f(0.74, 0.63, 0.34);
  let sandDk = vec3f(0.58, 0.49, 0.25);
  let grass = vec3f(0.33, 0.47, 0.21);
  let grassDk = vec3f(0.22, 0.35, 0.15);
  let rock = vec3f(0.45, 0.43, 0.39);
  let rockDk = vec3f(0.30, 0.29, 0.26);
  // Sand base with per-cell tone + fine grain.
  var col = mix(sand, sandDk, cellSeed * 0.5 + lf_vnoise(cell * 7.0) * 0.35);
  // Grass meadows (low-freq patches).
  let g = lf_vnoise(cell * 0.06 + vec2f(2.0, 9.0));
  col = mix(col, mix(grass, grassDk, cellSeed * 0.5), smoothstep(0.50, 0.66, g));
  // Rock outcrops (rarer, different field).
  let rk = lf_vnoise(cell * 0.085 + vec2f(17.0, 3.0));
  col = mix(col, mix(rock, rockDk, cellSeed * 0.5), smoothstep(0.66, 0.80, rk));
  return col;
}
// Rock-dominant mountain flank: grey rock base with per-cell tone + fine scree
// grain, lighter scree highlights, and sparse dry-grass tufts low in the noise.
fn lf_rock(cell: vec2f, cellSeed: f32) -> vec3f {
  let rock = vec3f(0.44, 0.42, 0.39);
  let rockDk = vec3f(0.27, 0.26, 0.24);
  let scree = vec3f(0.56, 0.54, 0.50);
  let dryGrass = vec3f(0.36, 0.40, 0.22);
  var col = mix(rock, rockDk, cellSeed * 0.5 + lf_vnoise(cell * 9.0) * 0.4);
  let sc = lf_vnoise(cell * 0.13 + vec2f(11.0, 4.0));
  col = mix(col, scree, smoothstep(0.62, 0.82, sc) * 0.6);
  let gr = lf_vnoise(cell * 0.07 + vec2f(31.0, 19.0));
  col = mix(col, dryGrass, smoothstep(0.30, 0.16, gr) * 0.45);
  return col;
}
// Manicured estate lawn: green with gentle mottle and a few darker shrubs. The
// per-cell slab joint reads as mowing stripes, which suits a lawn.
fn lf_lawn(cell: vec2f, cellSeed: f32) -> vec3f {
  let lawn = vec3f(0.24, 0.47, 0.23);
  let lawnDk = vec3f(0.16, 0.36, 0.17);
  let shrub = vec3f(0.13, 0.28, 0.15);
  var col = mix(lawn, lawnDk, cellSeed * 0.4 + lf_vnoise(cell * 5.0) * 0.4);
  let sh = lf_vnoise(cell * 0.09 + vec2f(7.0, 13.0));
  col = mix(col, shrub, smoothstep(0.80, 0.92, sh) * 0.5);
  return col;
}
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let width = D[0];
  let originX = D[1];
  let originZ = D[2];
  let matId = D[3];
  let variant = D[4];
  let style = D[5];
  // UV 0..1 over the footprint -> world XZ; 1 tile = 1 m so the cell IS world XZ.
  let cell = vec2f(originX + in.uv.x * width, originZ + in.uv.y * width);
  let id = floor(cell);
  let f = fract(cell);
  let seed = tf_rand(id + vec2f(3.1, 7.7)) * 50.0;
  let cellSeed = tf_rand(id + vec2f(5.2, 1.7));
  var col: vec3f;
  if (style > 2.5) {
    col = lf_lawn(cell, cellSeed);
  } else if (style > 1.5) {
    col = lf_rock(cell, cellSeed);
  } else if (style > 0.5) {
    col = lf_natural(cell, cellSeed);
  } else {
    col = tileMaterial(matId, f, f * 64.0, variant, seed);
  }
  // Slab joint at tile edges (same as the chunk floor) — keeps the grid read.
  let edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
  let aa = max(fwidth(edge), 0.0008);
  col = mix(col, col * 0.5, (1.0 - smoothstep(0.012, 0.012 + aa, edge)) * 0.8);
  return vec4f(col, 1.0);
}
`;

export function landformTextureKey(id: string): string {
  return `hmsc.landform.${id}`;
}

export function landformFillData(lf: Landform): number[] {
  const def = landformKindDef(lf.kind);
  const radius = def ? def.footprintRadius(lf.params, lf.field) : 1;
  const kind = def ? def.surfaceTileKind(lf.params) : 'sand';
  const style = def && def.surfaceStyle ? def.surfaceStyle(lf.params) : 0;
  const width = radius * 2;
  return [
    width,
    lf.centerX - radius,
    lf.centerZ - radius,
    tileFillMaterialId(kind),
    tileFillVariant(kind),
    style,
  ];
}

// ~8 px/tile, capped to fit the window framebuffer (same rule as the chunk floors).
const LANDFORM_MAX_CAPTURE_PX = 900;
export function landformCaptureDimension(lf: Landform): number {
  const def = landformKindDef(lf.kind);
  const width = (def ? def.footprintRadius(lf.params, lf.field) : 1) * 2;
  return Math.max(256, Math.min(LANDFORM_MAX_CAPTURE_PX, Math.round(width * 8)));
}
