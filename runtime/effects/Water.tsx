// Water — the animated canal/ocean fill, as a reusable registry Effect. This
// is THE canonical water shader for ReactJIT: it's the `water()` material from
// the effect_fills catalog (Board A / material 4), lifted out verbatim so carts
// import it instead of re-rolling — or, worse, baking a dead still-frame of it
// into a bitmap (which is exactly what scape3d did before this existed).
//
//   import { Water } from '@reactjit/effects';
//   <Water style={{ flexGrow: 1 }} variant={0} />
//
// Animation rides U.time (host-injected), so a standalone <Water> flows on its
// own. When captured into a <StaticSurface> (e.g. textured onto a 3D mesh
// face), StaticSurface caches the capture — bump `frame` every tick to force a
// re-capture so U.time keeps advancing. See cart/scape3d/render3d/WaterSurface.
//
// fbm / snoise come from the host's injected effect_math.wgsl; only sat / sat3 /
// line_near are bundled here (not in effect_math). VsOut + the U uniform
// (U.time, U.size_w/h) + the binding(1) storage buffer are injected by the
// Effect primitive.
import { Effect } from '../primitives';

export interface WaterProps {
  /** 0 = canal teal (A13), 1 = deep blue (A14), 2 = tropical + foam (A15). */
  variant?: 0 | 1 | 2;
  /** Noise phase seed; only shifts the pattern, not its character. */
  seed?: number;
  /**
   * Re-capture trigger. Bump this every frame ONLY when this effect is hosted
   * inside a cached <StaticSurface> (it forces the surface to re-capture so the
   * U.time-driven animation advances). Unused by the shader itself. Standalone
   * <Water> animates freely off U.time and should leave this at 0.
   */
  frame?: number;
  style?: any;
  [k: string]: any;
}

// W = [variant, seed, frame]. W[2] (frame) is the re-capture nonce; the shader
// never reads it. variant/seed match the effect_fills water() signature.
const WATER_WGSL = `
@group(0) @binding(1) var<storage, read> W: array<f32>;

fn sat(v: f32) -> f32 { return clamp(v, 0.0, 1.0); }
fn sat3(v: vec3f) -> vec3f { return clamp(v, vec3f(0.0, 0.0, 0.0), vec3f(1.0, 1.0, 1.0)); }
fn line_near(v: f32, width: f32) -> f32 {
  let aa = max(fwidth(v), 0.001);
  return 1.0 - smoothstep(width, width + aa, abs(v));
}

fn water(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let t = U.time;
  let warp = fbm(uv.x * 4.0 + t * 0.08 + seed, uv.y * 4.0 - t * 0.06, 4.0);
  let wave_a = sin((uv.x * 38.0 + uv.y * 11.0) + warp * 5.0 + t * (1.1 + variant * 0.2));
  let wave_b = sin((uv.x * -18.0 + uv.y * 42.0) + snoise(uv.x * 8.0, uv.y * 8.0 + seed) * 3.0 - t * 1.4);
  let caustic = smoothstep(0.72, 0.98, wave_a * 0.5 + wave_b * 0.5);
  var deep = vec3f(0.025, 0.13, 0.22);
  var shallow = vec3f(0.08, 0.55, 0.70);
  if (variant > 0.5 && variant < 1.5) {
    deep = vec3f(0.010, 0.050, 0.13);
    shallow = vec3f(0.07, 0.27, 0.60);
  } else if (variant >= 1.5) {
    deep = vec3f(0.035, 0.18, 0.17);
    shallow = vec3f(0.19, 0.72, 0.62);
  }
  var col = mix(deep, shallow, sat(uv.y * 0.55 + warp * 0.25 + 0.45)) + vec3f(0.22, 0.36, 0.40) * caustic;
  let foam = line_near(sin(uv.y * 22.0 + uv.x * 8.0 + t * 0.8), 0.035) * smoothstep(0.78, 1.0, variant);
  return sat3(mix(col, vec3f(0.82, 0.95, 0.91), foam * 0.36));
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let variant = W[0];
  let seed = W[1];
  let uv = in.uv;
  let px = uv * vec2f(U.size_w, U.size_h);
  return vec4f(water(uv, px, variant, seed), 1.0);
}
`;

export function Water({ variant = 0, seed = 71, frame = 0, ...rest }: WaterProps) {
  return <Effect shader={WATER_WGSL} data={[variant, seed, frame]} {...rest} />;
}

export default Water;
