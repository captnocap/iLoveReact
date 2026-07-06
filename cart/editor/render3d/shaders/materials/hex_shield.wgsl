// @material hex_shield
// @slug hex-shield
// @name Hex Shield
// @board neon_surface
// @variant-labels Cyan Barrier, Failing Magenta, Verdant Lattice
// @kind surface
// @tags neon_surface, energy, hex, glow
// @author fable-scifi_hull
fn hex_shield(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var scale = 5.0;
  if (variant >= 1.5) { scale = 7.0; }
  let p = uv * scale + vec2f(seed * 0.31, seed * 0.17);
  let r = vec2f(1.0, 1.7320508);
  let h = r * 0.5;
  let pa = (fract(p / r) - 0.5) * r;
  let pb = (fract((p - h) / r) - 0.5) * r;
  var gv = pa;
  if (dot(pb, pb) < dot(pa, pa)) { gv = pb; }
  let cid = p - gv;
  let ga = abs(gv);
  let hd = max(dot(ga, vec2f(0.5, 0.8660254)), ga.x);
  let edge = smoothstep(0.40, 0.485, hd);
  let cr = rand(cid + vec2f(seed, 3.7));
  let flicker = snoise(cid.x * 1.3 + seed, cid.y * 1.3) * 0.5 + 0.5;
  var deep = vec3f(0.02, 0.05, 0.10);
  var glow = vec3f(0.15, 0.85, 0.95);
  var fill = vec3f(0.05, 0.22, 0.30);
  var alive = 1.0;
  if (variant > 0.5 && variant < 1.5) {
    deep = vec3f(0.06, 0.02, 0.08);
    glow = vec3f(0.95, 0.25, 0.80);
    fill = vec3f(0.22, 0.05, 0.20);
    alive = step(0.35, cr);
  } else if (variant >= 1.5) {
    deep = vec3f(0.02, 0.07, 0.04);
    glow = vec3f(0.35, 0.95, 0.40);
    fill = vec3f(0.06, 0.24, 0.10);
  }
  var col = mix(deep, fill, (0.3 + flicker * 0.7) * alive);
  col = mix(col, glow, edge * (0.5 + flicker * 0.5) * alive);
  let sheen = exp(-pow((uv.x + uv.y * 0.6 - 0.8 - fract(seed * 0.113)), 2.0) * 6.0);
  col = col + glow * sheen * 0.25;
  let scan = sin(uv.y * 140.0 + seed * 5.0) * 0.5 + 0.5;
  col = col * (0.88 + scan * 0.12);
  return sat3(col);
}
