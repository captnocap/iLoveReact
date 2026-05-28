// Plasma — classic four-wave sine plasma, the canonical reusable Effect.
//
//   import { Plasma, PLASMA_DEFAULTS } from '@reactjit/effects';
//   <Plasma params={PLASMA_DEFAULTS} style={{ flexGrow: 1 }} />
//   <Plasma params={{ ...PLASMA_DEFAULTS, velocity: 2 }} />
import { Effect } from '../primitives';
import { rgb } from './_util';

export type PlasmaParams = {
  colors: { primary: string; secondary: string; tertiary: string };
  /** Spatial frequency of the waves (higher = tighter). */
  drift: number;
  /** Animation rate multiplier. */
  velocity: number;
  /** Overall opacity 0..1. */
  opacity: number;
};

export const PLASMA_DEFAULTS: PlasmaParams = {
  colors: { primary: '#ff00aa', secondary: '#00ffcc', tertiary: '#ffee00' },
  drift: 0.02,
  velocity: 1.0,
  opacity: 1.0,
};

// WGSL unpacks P[] in the SAME order the component packs it below.
const PLASMA_WGSL = `
@group(0) @binding(1) var<storage, read> P: array<f32>;
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  // Param unpacking — order must match the TS packer.
  let c1       = vec3f(P[0], P[1], P[2]);   // primary
  let c2       = vec3f(P[3], P[4], P[5]);   // secondary
  let c3       = vec3f(P[6], P[7], P[8]);   // tertiary
  let drift    = P[9];
  let velocity = P[10];
  let opacity  = P[11];

  let x = in.uv.x * U.size_w;
  let y = in.uv.y * U.size_h;
  let t = U.time * velocity;
  let fx = x * drift;
  let fy = y * drift;
  let v1 = sin(fx + t);
  let v2 = sin(fy + t * 0.7);
  let v3 = sin(fx + fy + t * 0.5);
  let v4 = sin(sqrt(fx * fx + fy * fy) + t);
  let v = (v1 + v2 + v3 + v4) * 0.25 + 0.5;

  let col = c1 * (sin(v * 3.14159) * 0.5 + 0.5)
          + c2 * (sin(v * 3.14159 + 2.094) * 0.5 + 0.5)
          + c3 * (sin(v * 3.14159 + 4.189) * 0.5 + 0.5);
  return vec4f(col * opacity, opacity);
}
`;

export function Plasma({ params, ...rest }: { params: PlasmaParams; [k: string]: any }) {
  // Packer — order must match the WGSL unpacker above.
  const data = [
    ...rgb(params.colors.primary),
    ...rgb(params.colors.secondary),
    ...rgb(params.colors.tertiary),
    params.drift,
    params.velocity,
    params.opacity,
  ];
  return <Effect shader={PLASMA_WGSL} data={data} {...rest} />;
}

export default Plasma;
