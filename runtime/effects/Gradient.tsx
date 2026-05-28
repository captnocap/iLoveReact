// Gradient — a clean linear gradient between two colors at any angle.
//
//   import { Gradient, GRADIENT_DEFAULTS } from '@reactjit/effects';
//   <Gradient params={GRADIENT_DEFAULTS} style={{ flexGrow: 1 }} />
//   <Gradient params={{ ...GRADIENT_DEFAULTS, angle: 135 }} />
import { Effect } from '../primitives';
import { rgb } from './_util';

export type GradientParams = {
  /** Start color (any hex / rgb()). */
  from: string;
  /** End color. */
  to: string;
  /** Direction in degrees (0 = left→right, 90 = top→bottom). */
  angle: number;
};

export const GRADIENT_DEFAULTS: GradientParams = {
  from: '#1b2a4a',
  to: '#0a0d14',
  angle: 90,
};

const GRADIENT_WGSL = `
@group(0) @binding(1) var<storage, read> P: array<f32>;
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  // Param unpacking — order must match the TS packer.
  let from  = vec3f(P[0], P[1], P[2]);
  let to    = vec3f(P[3], P[4], P[5]);
  let angle = P[6];

  let dir = vec2f(cos(angle), sin(angle));
  let t = clamp(dot(in.uv - 0.5, dir) + 0.5, 0.0, 1.0);
  return vec4f(mix(from, to, t), 1.0);
}
`;

export function Gradient({ params, ...rest }: { params: GradientParams; [k: string]: any }) {
  const data = [
    ...rgb(params.from),
    ...rgb(params.to),
    (params.angle * Math.PI) / 180,
  ];
  return <Effect shader={GRADIENT_WGSL} data={data} {...rest} />;
}

export default Gradient;
