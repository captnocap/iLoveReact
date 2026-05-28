// Crt — CRT-tube look (barrel distortion + chromatic fringe + scanlines +
// vignette) as a registry Effect that samples its CHILDREN.
//
// The proof that <Filter> is just <Effect> with children: an Effect with a
// subtree reads `subtree(uv)` (the captured children) instead of generating
// from scratch — identical plumbing to Plasma, only the source differs.
// Lifted from the old framework filter_shaders.zig crt_wgsl.
//
//   import { Crt, CRT_DEFAULTS } from '@reactjit/effects';
//   <Crt params={CRT_DEFAULTS} style={{ flexGrow: 1 }}>
//     <App />
//   </Crt>
import { Effect } from '../primitives';

export type CrtParams = {
  /** 0 = passthrough, 1 = full CRT. */
  intensity: number;
};

export const CRT_DEFAULTS: CrtParams = {
  intensity: 1,
};

// The Effect prelude provides `subtree(uv) -> vec4f` (the captured children),
// plus U.time / U.size_w/h and the storage param array.
const CRT_WGSL = `
@group(0) @binding(1) var<storage, read> P: array<f32>;
fn _barrel(uv: vec2f, k: f32) -> vec2f {
  let p = uv * 2.0 - 1.0;
  let r2 = dot(p, p);
  return (p * (1.0 + k * r2)) * 0.5 + 0.5;
}
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  // Param unpacking — order must match the TS packer.
  let k = P[0];   // intensity

  let uv = _barrel(in.uv, 0.15 * k);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    return vec4f(0.0);
  }
  let off = 0.0025 * k;
  let r = subtree(uv + vec2f(off, 0.0)).r;
  let g = subtree(uv).g;
  let b = subtree(uv - vec2f(off, 0.0)).b;
  var col = vec3f(r, g, b);
  // Scanlines — fixed 240-line pitch, independent of viewport size.
  let line = sin(uv.y * 240.0 * 3.14159) * 0.5 + 0.5;
  col = col * mix(1.0, 0.75 + 0.25 * line, k);
  // Vignette.
  let p = uv * 2.0 - 1.0;
  let vig = 1.0 - dot(p, p) * 0.35 * k;
  col = col * vig;
  let a = subtree(uv).a;
  return vec4f(col * a, a);
}
`;

export function Crt({ params, children, ...rest }: { params: CrtParams; children?: any; [k: string]: any }) {
  const data = [params.intensity];
  return <Effect shader={CRT_WGSL} data={data} {...rest}>{children}</Effect>;
}

export default Crt;
