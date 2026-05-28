// Rings — concentric sonar/ripple rings from center, aspect-corrected.
//
//   import { Rings, RINGS_DEFAULTS } from '@reactjit/effects';
//   <Rings params={RINGS_DEFAULTS} style={{ flexGrow: 1 }} />
//   <Rings params={{ ...RINGS_DEFAULTS, color: '#48d1ff', count: 12 }} />
import { Effect } from '../primitives';
import { rgb } from './_util';

export type RingsParams = {
  /** Ring color (any hex / rgb()). */
  color: string;
  /** Outward animation speed. */
  speed: number;
  /** Number of rings across the radius. */
  count: number;
};

export const RINGS_DEFAULTS: RingsParams = {
  color: '#ffffff',
  speed: 2,
  count: 8,
};

const RINGS_WGSL = `
@group(0) @binding(1) var<storage, read> P: array<f32>;
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  // Param unpacking — order must match the TS packer.
  let color = vec3f(P[0], P[1], P[2]);
  let speed = P[3];
  let count = P[4];

  let aspect = U.size_w / max(U.size_h, 1.0);
  let p = (in.uv - 0.5) * vec2f(aspect, 1.0);
  let r = length(p);
  let wave = sin(r * count * 6.2831853 - U.time * speed);
  let ring = smoothstep(0.0, 0.6, wave);
  return vec4f(color * ring, ring);
}
`;

export function Rings({ params, ...rest }: { params: RingsParams; [k: string]: any }) {
  const data = [...rgb(params.color), params.speed, params.count];
  return <Effect shader={RINGS_WGSL} data={data} {...rest} />;
}

export default Rings;
