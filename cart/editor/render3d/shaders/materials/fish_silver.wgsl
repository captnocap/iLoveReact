// @material fish_silver
// @slug fish-silver
// @name Fish Silver
// @board props
// @variant-labels Herring Flash, Deep Mackerel, Golden Scad
// @kind surface
// @tags props, scales, fish
// @author fable-creature_skins
fn fish_silver(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var hic = vec3f(0.82, 0.85, 0.88);
  var loc = vec3f(0.38, 0.44, 0.52);
  var backc = vec3f(0.20, 0.30, 0.42);
  if (variant > 0.5 && variant < 1.5) {
    hic = vec3f(0.68, 0.74, 0.78);
    loc = vec3f(0.22, 0.30, 0.40);
    backc = vec3f(0.09, 0.15, 0.24);
  } else if (variant >= 1.5) {
    hic = vec3f(0.92, 0.82, 0.55);
    loc = vec3f(0.55, 0.44, 0.26);
    backc = vec3f(0.40, 0.28, 0.14);
  }
  let p = vec2f(uv.x * 18.0 + seed * 0.23, uv.y * 24.0 - seed * 0.13);
  let row = floor(p.y);
  let fx = fract(p.x + fract(row * 0.5));
  let fy = fract(p.y);
  let arc = length(vec2f((fx - 0.5) * 1.2, (fy - 0.05) * 0.9));
  let inside = 1.0 - smoothstep(0.45, 0.54, arc);
  let tone = rand(vec2f(floor(p.x + fract(row * 0.5)), row) + seed);
  var col = mix(loc, hic, inside * (0.55 + tone * 0.45));
  col = mix(col, backc, smoothstep(0.45, 0.05, uv.y) * 0.65);
  let flash = pow(sat(sin(uv.y * 5.0 + uv.x * 3.0 + seed * 0.11)), 5.0);
  col = col + vec3f(0.25, 0.27, 0.30) * flash;
  col = col + hsv2rgb(fract(uv.y * 1.5 + seed * 0.03), 0.45, 1.0) * flash * 0.18;
  col = col - vec3f(0.12, 0.13, 0.14) * smoothstep(0.55, 0.95, fy) * inside * 0.6;
  col = mix(col, vec3f(0.95, 0.96, 0.97), speckle(px, 2.0, seed, 0.97) * 0.7);
  return sat3(col);
}
