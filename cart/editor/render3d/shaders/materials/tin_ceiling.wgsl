// @material tin_ceiling
// @slug tin-ceiling
// @name Tin Ceiling
// @board liminal
// @variant-labels Painted Cream, Raw Tin, Verdigris Rot
// @kind surface
// @tags liminal, ceiling, pressed, ornament
// @author fable-interior_home
fn tin_ceiling(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.88, 0.86, 0.78);
  var recess = vec3f(0.58, 0.55, 0.46);
  var wear_tone = vec3f(0.42, 0.35, 0.26);
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.66, 0.68, 0.72);
    recess = vec3f(0.38, 0.40, 0.46);
    wear_tone = vec3f(0.30, 0.26, 0.22);
  } else if (variant >= 1.5) {
    base = vec3f(0.55, 0.48, 0.36);
    recess = vec3f(0.30, 0.44, 0.38);
    wear_tone = vec3f(0.24, 0.42, 0.36);
  }
  let cell = floor(uv * 3.0);
  let p = fract(uv * 3.0) - vec2f(0.5, 0.5);
  let r = length(p);
  let ang = atan2(p.y, p.x);
  let petals = (sin(ang * 8.0 + seed * 0.1) * 0.5 + 0.5) * (1.0 - smoothstep(0.12, 0.34, abs(r - 0.24)));
  let rings = (sin(r * 26.0 - 1.2) * 0.5 + 0.5) * (1.0 - smoothstep(0.05, 0.40, r));
  let b = max(abs(p.x), abs(p.y));
  let frame_line = 1.0 - smoothstep(0.0, 0.02, abs(b - 0.43));
  let dotc = 1.0 - smoothstep(0.03, 0.06, r);
  let emboss = petals * 0.5 + rings * 0.5 + frame_line * 0.8 + dotc;
  var col = mix(recess, base, 0.55 + 0.45 * sat(emboss));
  col = col + vec3f(0.08) * sat(emboss) * smoothstep(0.8, 0.2, uv.y);
  let tarnish = fbm(uv.x * 5.0 + seed, uv.y * 5.0 + cell.x, 3.0) * 0.5 + 0.5;
  col = mix(col, wear_tone, smoothstep(0.62, 0.95, tarnish) * 0.55);
  col = mix(col, wear_tone * 0.8, speckle(px, 2.0, seed + 3.0, 0.955) * 0.7);
  return sat3(col);
}
