// Gradient — a clean linear gradient between two colors at any angle. The most
// reused fill there is; pixel-perfect at any size (it's an Effect, not CSS).
//
//   import { Gradient } from '@reactjit/effects';
//   <Gradient from="#1b2a4a" to="#0a0d14" angle={135} style={{ flexGrow: 1 }} />
import { Effect } from '../primitives';
import { rgb } from './_util';

export interface GradientProps {
  /** Start color (any hex / rgb()). */
  from?: string;
  /** End color. */
  to?: string;
  /** Gradient direction in degrees (0 = left→right, 90 = top→bottom). */
  angle?: number;
  style?: any;
  [k: string]: any;
}

const GRADIENT_WGSL = `
@group(0) @binding(1) var<storage, read> P: array<f32>;
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let a = P[6];
  let dir = vec2f(cos(a), sin(a));
  // Project centered uv onto the direction → 0..1 across the gradient axis.
  let t = clamp(dot(in.uv - 0.5, dir) + 0.5, 0.0, 1.0);
  let from = vec3f(P[0], P[1], P[2]);
  let to = vec3f(P[3], P[4], P[5]);
  return vec4f(mix(from, to, t), 1.0);
}
`;

export function Gradient({ from = '#222222', to = '#000000', angle = 90, ...rest }: GradientProps) {
  const [fr, fg, fb] = rgb(from);
  const [tr, tg, tb] = rgb(to);
  const a = (angle * Math.PI) / 180;
  return <Effect shader={GRADIENT_WGSL} data={[fr, fg, fb, tr, tg, tb, a]} {...rest} />;
}

export default Gradient;
