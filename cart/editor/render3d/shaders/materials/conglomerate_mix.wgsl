// @material conglomerate_mix
// @slug conglomerate-mix
// @name Conglomerate Mix
// @board wood_brick_stone
// @variant-labels River Pudding, Red Matrix, Coarse Cobble
// @kind surface
// @tags wood_brick_stone, conglomerate, pebbles, stone
// @author fable-geology
fn conglomerate_mix(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var cement = vec3f(0.58, 0.52, 0.44);
  var peb_a = vec3f(0.70, 0.62, 0.52);
  var peb_b = vec3f(0.36, 0.34, 0.34);
  var peb_c = vec3f(0.60, 0.42, 0.30);
  var scale = 8.0;
  if (variant > 0.5 && variant < 1.5) {
    cement = vec3f(0.52, 0.30, 0.22);
    peb_a = vec3f(0.74, 0.66, 0.56);
    peb_b = vec3f(0.30, 0.28, 0.30);
    peb_c = vec3f(0.66, 0.50, 0.34);
  } else if (variant >= 1.5) {
    cement = vec3f(0.48, 0.46, 0.42);
    peb_a = vec3f(0.68, 0.64, 0.58);
    peb_b = vec3f(0.26, 0.28, 0.32);
    peb_c = vec3f(0.56, 0.44, 0.28);
    scale = 5.0;
  }
  let grain = fbm(uv.x * 30.0 + seed, uv.y * 30.0, 3.0);
  var col = cement * (0.88 + grain * 0.4);
  col = mix(col, peb_a * 0.9, speckle(px, 3.0, seed + 1.0, 0.93) * 0.5);
  let vc = voronoi(uv.x * scale + seed * 0.8, uv.y * scale - seed * 0.5);
  let cid = rand(vec2f(vc.y, seed * 0.06));
  let peb = smoothstep(0.34, 0.26, vc.x);
  var pcol = peb_a;
  if (cid > 0.66) { pcol = peb_b; } else if (cid > 0.33) { pcol = peb_c; }
  pcol = pcol * (0.8 + fract(cid * 9.7) * 0.45);
  pcol = mix(pcol, pcol * 0.55, smoothstep(0.20, 0.32, vc.x));
  pcol = pcol + vec3f(0.16, 0.15, 0.13) * smoothstep(0.12, 0.02, vc.x);
  col = mix(col, pcol, peb);
  let vs = voronoi(uv.x * 21.0 - seed * 0.3, uv.y * 21.0 + seed);
  let sgate = step(0.72, rand(vec2f(vs.y, 4.4)));
  col = mix(col, peb_c * (0.7 + fract(vs.y * 3.3) * 0.5), smoothstep(0.18, 0.10, vs.x) * sgate * (1.0 - peb));
  return sat3(col);
}
