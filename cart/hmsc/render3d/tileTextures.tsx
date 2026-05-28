import { Effect, StaticSurface } from '@reactjit/runtime/primitives';
import { HMSC_TILE_TEXTURE_KEYS } from '../world/tileTextureKeys';

const TEXTURE_PIXELS = 256;
const TILE_TEXTURE_SHADER = `
@group(0) @binding(1) var<storage, read> D: array<f32>;

fn sat(v: f32) -> f32 { return clamp(v, 0.0, 1.0); }
fn sat3(v: vec3f) -> vec3f { return clamp(v, vec3f(0.0, 0.0, 0.0), vec3f(1.0, 1.0, 1.0)); }
fn rand(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123); }
fn line_near(v: f32, width: f32) -> f32 {
  let aa = max(fwidth(v), 0.001);
  return 1.0 - smoothstep(width, width + aa, abs(v));
}
fn speckle(px: vec2f, size: f32, seed: f32, threshold: f32) -> f32 {
  let cell = floor(px / size);
  return step(threshold, rand(cell + vec2f(seed * 19.0, seed * 7.0)));
}
fn crack_field(uv: vec2f, seed: f32, scale: f32) -> f32 {
  let n = snoise(uv.x * scale + seed, uv.y * scale * 1.7 - seed);
  let gate = smoothstep(0.35, 0.82, fbm(uv.x * 3.2 + seed, uv.y * 3.2, 4.0) * 0.5 + 0.5);
  return line_near(n, 0.020) * gate;
}

fn asphalt(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let coarse = fbm(uv.x * 18.0 + seed, uv.y * 18.0 - seed, 5.0) * 0.5 + 0.5;
  let tar = fbm(uv.x * 5.0 - seed * 0.4, uv.y * 11.0 + seed * 0.3, 4.0) * 0.5 + 0.5;
  var col = mix(vec3f(0.030, 0.033, 0.034), vec3f(0.125, 0.128, 0.122), coarse);
  col = mix(col, vec3f(0.012, 0.014, 0.015), smoothstep(0.72, 0.98, tar) * 0.38);
  col = col + vec3f(0.13, 0.13, 0.12) * speckle(px, 2.4, seed, 0.948);
  col = col - vec3f(0.045, 0.043, 0.040) * speckle(px + vec2f(19.0, 7.0), 3.5, seed, 0.955);
  col = col - vec3f(0.055, 0.054, 0.052) * crack_field(uv, seed, 8.0);
  if (variant < 0.5) {
    let dash = step(0.38, fract(uv.y * 5.0 + 0.08));
    let stripe = line_near(uv.x - 0.50 + snoise(uv.y * 2.0, seed) * 0.010, 0.022) * dash;
    col = mix(col, vec3f(0.96, 0.74, 0.26), stripe * 0.90);
  } else if (variant < 1.5) {
    let tar_patch = smoothstep(0.54, 0.63, fbm(uv.x * 6.0 + 8.0, uv.y * 6.0 + seed, 4.0) * 0.5 + 0.5);
    col = mix(col, vec3f(0.018, 0.020, 0.021), tar_patch * 0.36);
  }
  return sat3(col);
}

fn concrete(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let cloud = fbm(uv.x * 7.0 + seed * 0.7, uv.y * 7.0 - seed, 5.0) * 0.5 + 0.5;
  let trowel = sin((uv.x * 0.9 + uv.y * 1.6 + fbm(uv.x * 2.5, uv.y * 2.5 + seed, 3.0) * 0.18) * 24.0) * 0.5 + 0.5;
  var col = mix(vec3f(0.40, 0.405, 0.390), vec3f(0.72, 0.72, 0.68), cloud) + vec3f(trowel * 0.035);
  if (variant < 1.5) {
    col = col - vec3f(sat(line_near(uv.x - 0.50, 0.010) + line_near(uv.y - 0.50, 0.010)) * 0.12);
  } else {
    col = col - vec3f(crack_field(uv, seed, 7.5) * 0.18);
  }
  col = col - vec3f(speckle(px, 4.5, seed, 0.91) * 0.075) + vec3f(speckle(px + vec2f(11.0, 23.0), 6.5, seed, 0.965) * 0.065);
  return sat3(col);
}

fn sand(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let dune_warp = fbm(uv.x * 3.0 + seed, uv.y * 2.0 - seed, 4.0);
  let ripple = line_near(sin(uv.y * (34.0 + variant * 5.0) + uv.x * (9.0 - variant * 2.0) + dune_warp * 4.0), 0.055 + variant * 0.012);
  let noise = fbm(uv.x * 20.0, uv.y * 20.0 + seed, 4.0) * 0.5 + 0.5;
  var col = mix(vec3f(0.66, 0.50, 0.30), vec3f(0.90, 0.76, 0.48), noise);
  col = col + vec3f(0.12, 0.10, 0.06) * ripple;
  col = col + vec3f(0.09, 0.075, 0.045) * speckle(px, 1.8, seed, 0.72) - vec3f(0.10, 0.075, 0.045) * speckle(px + vec2f(5.0, 13.0), 2.6, seed, 0.82);
  return sat3(col);
}

fn mud(uv: vec2f, px: vec2f, seed: f32) -> vec3f {
  let clump = fbm(uv.x * 11.0 + seed, uv.y * 13.0 - seed, 5.0) * 0.5 + 0.5;
  let wet = smoothstep(0.50, 0.88, fbm(uv.x * 4.0 - seed, uv.y * 5.0 + seed, 4.0) * 0.5 + 0.5);
  var col = mix(vec3f(0.18, 0.11, 0.065), vec3f(0.42, 0.28, 0.16), clump);
  col = mix(col, vec3f(0.055, 0.045, 0.038), wet * 0.42);
  col = col - vec3f(crack_field(uv, seed, 5.0) * 0.10);
  col = col + vec3f(0.09, 0.07, 0.045) * speckle(px, 4.0, seed, 0.92);
  return sat3(col);
}

fn brick(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let rows = 6.0 + variant;
  let cols = 3.2 + variant * 0.55;
  let row = floor(uv.y * rows);
  let offset = (row - floor(row * 0.5) * 2.0) * 0.5;
  let buv = vec2f(uv.x * cols + offset, uv.y * rows);
  let cell = floor(buv);
  let local = fract(buv);
  let near_x = min(local.x, 1.0 - local.x);
  let near_y = min(local.y, 1.0 - local.y);
  let mortar = max(1.0 - smoothstep(0.030, 0.055, near_x), 1.0 - smoothstep(0.035, 0.065, near_y));
  let tone = rand(cell + vec2f(seed, seed * 2.0));
  var col = mix(vec3f(0.45, 0.13, 0.075), vec3f(0.82, 0.31, 0.16), tone);
  col = mix(col, vec3f(0.55, 0.53, 0.48), mortar * 0.72);
  col = mix(col, vec3f(0.045, 0.090, 0.045), smoothstep(0.42, 0.70, fbm(uv.x * 6.0 + seed, uv.y * 9.0, 5.0) * 0.5 + 0.5) * smoothstep(0.40, 0.96, uv.y) * 0.42);
  return sat3(col - vec3f(speckle(px, 5.0, seed, 0.935) * 0.12));
}

fn wood(uv: vec2f, px: vec2f, seed: f32) -> vec3f {
  let warp = fbm(uv.x * 4.0 + seed, uv.y * 10.0 - seed, 5.0);
  let x = uv.x + warp * 0.075 + sin(uv.y * 9.0 + seed) * 0.015;
  let grain = sin(x * 54.0 + fbm(uv.x * 13.0, uv.y * 4.0 + seed, 3.0) * 7.0) * 0.5 + 0.5;
  var col = mix(vec3f(0.28, 0.13, 0.055), vec3f(0.76, 0.42, 0.18), grain * 0.72 + 0.16);
  col = col - vec3f(0.10, 0.07, 0.035) * speckle(px, 3.0, seed, 0.945);
  col = col + vec3f(line_near(sin(uv.x * 220.0 + seed), 0.10) * 0.025);
  return sat3(col);
}

fn marker(uv: vec2f, px: vec2f, seed: f32) -> vec3f {
  let grid = sat(line_near(fract(uv.x * 8.0) - 0.5, 0.025) + line_near(fract(uv.y * 8.0) - 0.5, 0.025));
  var col = mix(vec3f(0.03, 0.16, 0.22), vec3f(0.05, 0.92, 0.95), grid);
  col = mix(col, vec3f(1.0, 0.16, 0.55), speckle(px, 6.0, seed, 0.90) * 0.42);
  return sat3(col);
}

fn water(uv: vec2f, px: vec2f, seed: f32) -> vec3f {
  let wave = sin((uv.x * 18.0 + uv.y * 7.0) + fbm(uv.x * 4.0 + seed, uv.y * 4.0, 4.0) * 4.0) * 0.5 + 0.5;
  let chop = fbm(uv.x * 22.0 - seed, uv.y * 18.0 + seed, 4.0) * 0.5 + 0.5;
  var col = mix(vec3f(0.03, 0.27, 0.48), vec3f(0.30, 0.63, 0.88), wave * 0.55 + chop * 0.25);
  col = col + vec3f(0.18, 0.26, 0.28) * line_near(sin(uv.x * 70.0 + uv.y * 36.0 + seed), 0.045);
  return sat3(col);
}

fn district(uv: vec2f, px: vec2f, base: vec3f, accent: vec3f, seed: f32) -> vec3f {
  let grain = fbm(uv.x * 10.0 + seed, uv.y * 10.0 - seed, 4.0) * 0.5 + 0.5;
  let block_x = line_near(fract(uv.x * 4.0) - 0.5, 0.018);
  let block_y = line_near(fract(uv.y * 5.0) - 0.5, 0.018);
  var col = mix(base * 0.78, base * 1.16, grain);
  col = mix(col, accent, sat(block_x + block_y) * 0.28);
  col = col - vec3f(speckle(px, 5.0, seed, 0.94) * 0.08);
  return sat3(col);
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let material = i32(D[0] + 0.5);
  let variant = D[1];
  let seed = D[2];
  let uv = in.uv;
  let px = uv * 256.0;
  var col = asphalt(uv, px, variant, seed);
  if (material == 1) { col = concrete(uv, px, variant, seed); }
  if (material == 2) { col = sand(uv, px, variant, seed); }
  if (material == 3) { col = mud(uv, px, seed); }
  if (material == 4) { col = brick(uv, px, variant, seed); }
  if (material == 5) { col = wood(uv, px, seed); }
  if (material == 6) { col = marker(uv, px, seed); }
  if (material == 7) { col = water(uv, px, seed); }
  if (material == 8) { col = district(uv, px, vec3f(0.07, 0.25, 0.36), vec3f(0.42, 0.62, 0.72), seed); }
  if (material == 9) { col = district(uv, px, vec3f(0.36, 0.12, 0.13), vec3f(0.78, 0.34, 0.30), seed); }
  if (material == 10) { col = district(uv, px, vec3f(0.02, 0.25, 0.07), vec3f(0.42, 0.70, 0.38), seed); }
  return vec4f(col, 1.0);
}
`;

const TILE_TEXTURE_SOURCES = [
  { key: HMSC_TILE_TEXTURE_KEYS.water, data: [7, 0, 37] },
  { key: HMSC_TILE_TEXTURE_KEYS.residential, data: [8, 0, 83] },
  { key: HMSC_TILE_TEXTURE_KEYS.downtown, data: [9, 0, 149] },
  { key: HMSC_TILE_TEXTURE_KEYS.mixed, data: [10, 0, 191] },
  { key: HMSC_TILE_TEXTURE_KEYS.road, data: [0, 0, 101] },
  { key: HMSC_TILE_TEXTURE_KEYS.asphalt, data: [0, 1, 211] },
  { key: HMSC_TILE_TEXTURE_KEYS.sidewalk, data: [1, 1, 307] },
  { key: HMSC_TILE_TEXTURE_KEYS.mud, data: [3, 0, 409] },
  { key: HMSC_TILE_TEXTURE_KEYS.sand, data: [2, 0, 503] },
  { key: HMSC_TILE_TEXTURE_KEYS.wall, data: [4, 1, 607] },
  { key: HMSC_TILE_TEXTURE_KEYS.door, data: [5, 0, 709] },
  { key: HMSC_TILE_TEXTURE_KEYS.marker, data: [6, 0, 811] },
];

export function HmscTileTextureSources() {
  return (
    <>
      {TILE_TEXTURE_SOURCES.map((source) => (
        <StaticSurface
          key={source.key}
          staticKey={source.key}
          style={{ position: 'absolute', left: -99999, top: 0, width: TEXTURE_PIXELS, height: TEXTURE_PIXELS }}
        >
          <Effect shader={TILE_TEXTURE_SHADER} data={source.data} style={{ width: TEXTURE_PIXELS, height: TEXTURE_PIXELS }} />
        </StaticSurface>
      ))}
    </>
  );
}
