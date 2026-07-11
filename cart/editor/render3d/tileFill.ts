// Editor-owned procedural tile materials.
import type { TileKind } from '../design';
import { tileKindDefinition } from '../world/tileKinds';

// Procedural tile materials ported from cart/effect_fills (the static env set:
// concrete, road, sand). fbm()/snoise() are injected by the <Effect> primitive,
// so this WGSL works in any Effect surface. Prepend TILE_FILL_WGSL to a shader, then call
// tileMaterial(matId, uv, px, variant, seed) per cell.
//
// matId: 0 concrete (sidewalk), 1 road (road/asphalt), 2 sand (sand/mud), 3 grass.
export const TILE_FILL_WGSL = `
fn sat(v: f32) -> f32 { return clamp(v, 0.0, 1.0); }
fn sat3(v: vec3f) -> vec3f { return clamp(v, vec3f(0.0), vec3f(1.0)); }
fn tf_rand(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123); }
fn line_near(v: f32, width: f32) -> f32 {
  let aa = max(fwidth(v), 0.001);
  return 1.0 - smoothstep(width, width + aa, abs(v));
}
fn speckle(px: vec2f, size: f32, seed: f32, threshold: f32) -> f32 {
  let cell = floor(px / size);
  return step(threshold, tf_rand(cell + vec2f(seed * 19.0, seed * 7.0)));
}
fn crack_field(uv: vec2f, seed: f32, scale: f32) -> f32 {
  let n = snoise(uv.x * scale + seed, uv.y * scale * 1.7 - seed);
  let gate = smoothstep(0.35, 0.82, fbm(uv.x * 3.2 + seed, uv.y * 3.2, 4.0) * 0.5 + 0.5);
  return line_near(n, 0.020) * gate;
}

fn fill_concrete(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let cloud = fbm(uv.x * 7.0 + seed * 0.7, uv.y * 7.0 - seed, 5.0) * 0.5 + 0.5;
  let trowel = sin((uv.x * 0.9 + uv.y * 1.6 + fbm(uv.x * 2.5, uv.y * 2.5 + seed, 3.0) * 0.18) * 24.0) * 0.5 + 0.5;
  var col = mix(vec3f(0.40, 0.405, 0.390), vec3f(0.72, 0.72, 0.68), cloud) + vec3f(trowel * 0.035);
  col = col - vec3f(crack_field(uv, seed, 7.5) * 0.14);
  col = col - vec3f(speckle(px, 4.5, seed, 0.91) * 0.075) + vec3f(speckle(px + vec2f(11.0, 23.0), 6.5, seed, 0.965) * 0.065);
  return sat3(col);
}

fn fill_road(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let coarse = fbm(uv.x * 18.0 + seed, uv.y * 18.0 - seed, 5.0) * 0.5 + 0.5;
  let tar = fbm(uv.x * 5.0 - seed * 0.4, uv.y * 11.0 + seed * 0.3, 4.0) * 0.5 + 0.5;
  var col = mix(vec3f(0.030, 0.033, 0.034), vec3f(0.125, 0.128, 0.122), coarse);
  col = mix(col, vec3f(0.012, 0.014, 0.015), smoothstep(0.72, 0.98, tar) * 0.38);
  col = col + vec3f(0.13, 0.13, 0.12) * speckle(px, 2.4, seed, 0.948);
  col = col - vec3f(0.055, 0.054, 0.052) * crack_field(uv, seed, 8.0);
  if (variant >= 1.5) {
    let tar_patch = smoothstep(0.54, 0.63, fbm(uv.x * 6.0 + 8.0, uv.y * 6.0 + seed, 4.0) * 0.5 + 0.5);
    col = mix(col, vec3f(0.018, 0.020, 0.021), tar_patch * 0.36);
  }
  return sat3(col);
}

fn fill_sand(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let dune_warp = fbm(uv.x * 3.0 + seed, uv.y * 2.0 - seed, 4.0);
  let ripple = line_near(sin(uv.y * 34.0 + uv.x * 9.0 + dune_warp * 4.0), 0.055);
  let noise = fbm(uv.x * 20.0, uv.y * 20.0 + seed, 4.0) * 0.5 + 0.5;
  var col = mix(vec3f(0.66, 0.50, 0.30), vec3f(0.90, 0.76, 0.48), noise);
  col = col + vec3f(0.12, 0.10, 0.06) * ripple;
  col = col + vec3f(0.09, 0.075, 0.045) * speckle(px, 1.8, seed, 0.72) - vec3f(0.10, 0.075, 0.045) * speckle(px + vec2f(5.0, 13.0), 2.6, seed, 0.82);
  return sat3(col);
}

// Living ground — a green grassy lawn (not the sand 'soil' fell through to before).
// variant 0 = lush green (matches the painter swatch ~#3f7d33); variant 1 = dry,
// shifted toward yellow-green (the grassDry tile). Patchy fbm tone + fine blade
// speckle + scattered dirt flecks so it reads as turf, not flat paint.
fn fill_grass(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // NB: do not name a var 'patch' here — it is a WGSL reserved keyword.
  let tone = fbm(uv.x * 8.0 + seed, uv.y * 8.0 - seed, 5.0) * 0.5 + 0.5;
  let fine = fbm(uv.x * 46.0, uv.y * 46.0 + seed, 3.0) * 0.5 + 0.5;
  let lush = mix(vec3f(0.16, 0.40, 0.15), vec3f(0.30, 0.55, 0.22), tone);
  let dry = mix(vec3f(0.40, 0.45, 0.20), vec3f(0.56, 0.58, 0.30), tone);
  var col = mix(lush, dry, sat(variant));
  col = col + vec3f(0.04, 0.06, 0.025) * fine;
  col = col - vec3f(0.05, 0.05, 0.035) * speckle(px, 2.0, seed, 0.88);
  return sat3(col);
}

fn tileMaterial(matId: f32, uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  if (matId < 0.5) { return fill_concrete(uv, px, variant, seed); }
  if (matId < 1.5) { return fill_road(uv, px, variant, seed); }
  if (matId < 2.5) { return fill_sand(uv, px, variant, seed); }
  return fill_grass(uv, px, variant, seed);
}
`;

// TileKind → tileMaterial id, by the kind's DECLARED surface material (not its
// name): every road-family kind (the lane trios, junction, crosswalk, median,
// parking — all material:'road') reads as asphalt, not concrete. The old
// name-switch only caught the literal 'road'/'asphalt' kinds, so lane tiles fell
// through to concrete and the painted road vanished into the ground (req_0774).
// One source of truth — a new road kind maps correctly with no edit here.
export function tileFillMaterialId(kind: TileKind): number {
  // Grass is a GREEN lawn, not the sand its 'soil' surface material would fall
  // through to (the painter shows it green; the 3D ground must match). All grass
  // density variants (grass/grassDry/grassSparse/grassLush) share the green fill.
  if (kind.startsWith('grass')) return 3;
  const m = tileKindDefinition(kind).surface?.material;
  if (m === 'road') return 1; // asphalt
  if (m === 'sand' || m === 'soil') return 2; // sand / earth (no separate soil fill yet)
  return 0; // concrete, water, structural, markers → concrete grain
}

export function tileFillVariant(kind: TileKind): number {
  switch (kind) {
    case 'asphalt':
      return 2;
    case 'road':
      return 0;
    case 'grassDry':
      return 1; // the dry grass tile reads yellow-green (fill_grass variant 1)
    default:
      return 0;
  }
}
