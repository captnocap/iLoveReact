// Rings — concentric sonar/ripple rings radiating from center. Aspect-corrected
// so the rings stay circular at any quad shape.
//
//   import { Rings } from '@reactjit/effects';
//   <Rings color="#48d1ff" speed={2} count={8} style={{ flexGrow: 1 }} />
import { Effect } from '../primitives';
import { rgb } from './_util';

export interface RingsProps {
  /** Ring color (any hex / rgb()). */
  color?: string;
  /** Outward animation speed (1 = default). */
  speed?: number;
  /** Number of rings across the radius. */
  count?: number;
  style?: any;
  [k: string]: any;
}

const RINGS_WGSL = `
@group(0) @binding(1) var<storage, read> P: array<f32>;
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let speed = P[3];
  let count = P[4];
  let aspect = U.size_w / max(U.size_h, 1.0);
  let p = (in.uv - 0.5) * vec2f(aspect, 1.0);
  let r = length(p);
  let wave = sin(r * count * 6.2831853 - U.time * speed);
  let ring = smoothstep(0.0, 0.6, wave);
  let col = vec3f(P[0], P[1], P[2]) * ring;
  return vec4f(col, ring);
}
`;

export function Rings({ color = '#ffffff', speed = 2, count = 8, ...rest }: RingsProps) {
  const [r, g, b] = rgb(color);
  return <Effect shader={RINGS_WGSL} data={[r, g, b, speed, count]} {...rest} />;
}

export default Rings;
