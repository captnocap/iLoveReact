// Plasma — the classic four-wave sine plasma, as a reusable registry Effect.
// This is THE canonical plasma for ReactJIT; carts import it instead of
// re-rolling the shader. Drives off U.time and reuses effect_math's hsv2rgb.
//
//   import { Plasma } from '@reactjit/effects';
//   <Plasma style={{ flexGrow: 1 }} speed={1.4} scale={1} />
import { Effect } from '../primitives';

export interface PlasmaProps {
  /** Animation speed multiplier (1 = default). */
  speed?: number;
  /** Spatial frequency of the waves (1 = default; higher = tighter). */
  scale?: number;
  /** Color saturation 0..1. */
  saturation?: number;
  /** Static hue offset 0..1 added to the cycling rainbow. */
  hueShift?: number;
  style?: any;
  [k: string]: any;
}

// Params reach WGSL through the storage buffer at @group(0) @binding(1).
const PLASMA_WGSL = `
@group(0) @binding(1) var<storage, read> P: array<f32>;
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let speed = P[0];
  let scale = P[1];
  let sat = P[2];
  let hueShift = P[3];
  let t = U.time * speed;
  let x = in.uv.x * U.size_w;
  let y = in.uv.y * U.size_h;
  let fx = x * 0.02 * scale;
  let fy = y * 0.02 * scale;
  let v1 = sin(fx + t);
  let v2 = sin(fy + t * 0.7);
  let v3 = sin(fx + fy + t * 0.5);
  let v4 = sin(sqrt(fx * fx + fy * fy) + t);
  let v = (v1 + v2 + v3 + v4) * 0.25 * 0.5 + 0.5;
  let col = hsv2rgb(fract(v + hueShift), sat, 1.0);
  return vec4f(col, 1.0);
}
`;

export function Plasma({ speed = 1, scale = 1, saturation = 0.7, hueShift = 0, ...rest }: PlasmaProps) {
  return <Effect shader={PLASMA_WGSL} data={[speed, scale, saturation, hueShift]} {...rest} />;
}

export default Plasma;
