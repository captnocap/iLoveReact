// Still-water surface texture for the crater lake — a calm blue/teal field with a
// soft ripple shimmer and a lighter shallow rim, captured once and sampled on the
// flat water plane. Opaque (per-mesh alpha isn't plumbed through the host yet), but
// the ripple + rim read as water from the shore and the air above. The mesh is a
// thin plane at the water level; its corners tuck under the crater walls so the
// visible waterline is the round bowl edge.
export const WATER_FILL_SHADER = `
@group(0) @binding(1) var<storage, read> D: array<f32>;
fn wtr_rand(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453);
}
fn wtr_noise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let a = wtr_rand(i);
  let b = wtr_rand(i + vec2f(1.0, 0.0));
  let c = wtr_rand(i + vec2f(0.0, 1.0));
  let d = wtr_rand(i + vec2f(1.0, 1.0));
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let uv = in.uv;
  let deep = vec3f(0.09, 0.27, 0.41);
  let shallow = vec3f(0.20, 0.50, 0.62);
  // Distance from the disc center (uv 0.5,0.5) → shallower/brighter toward the rim.
  let rc = length(uv - vec2f(0.5, 0.5)) * 2.0;
  var col = mix(deep, shallow, smoothstep(0.55, 1.0, rc));
  // Two octaves of ripple shimmer.
  let rip = wtr_noise(uv * 22.0) * 0.6 + wtr_noise(uv * 48.0) * 0.4;
  col = col + vec3f(0.06, 0.08, 0.09) * (rip - 0.5);
  // A few brighter specular glints.
  let glint = smoothstep(0.86, 1.0, wtr_noise(uv * 60.0 + vec2f(3.0, 7.0)));
  col = col + vec3f(0.18, 0.20, 0.22) * glint;
  return vec4f(col, 1.0);
}
`;

export function waterTextureKey(id: string): string {
  return `hmsc.water.${id}`;
}
