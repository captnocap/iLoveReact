// @material azulejo_blue
// @slug azulejo-blue
// @name Azulejo Blue
// @board wood_brick_stone
// @variant-labels Lisbon Noon, Aged Cellar, Navy Dense
// @kind surface
// @tags wood_brick_stone, azulejo, portuguese, tile
// @author fable-mosaic_tile
fn azulejo_blue(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let sc = 3.0;
  let cell = floor(uv * sc);
  let lc = fract(uv * sc);
  let q = abs(lc - vec2f(0.5, 0.5));
  var paper = vec3f(0.92, 0.93, 0.90);
  var cobalt = vec3f(0.13, 0.26, 0.55);
  var dense = 0.0;
  if (variant > 0.5 && variant < 1.5) {
    paper = vec3f(0.88, 0.85, 0.74);
    cobalt = vec3f(0.20, 0.30, 0.48);
  } else if (variant >= 1.5) {
    paper = vec3f(0.90, 0.91, 0.90);
    cobalt = vec3f(0.09, 0.16, 0.42);
    dense = 1.0;
  }
  // fourfold ornament from folded coordinates
  let ph = rand(cell + vec2f(seed * 0.17, seed * 0.05)) * 6.28;
  let w1 = sin(q.x * 14.0 + ph) * sin(q.y * 14.0 - ph);
  let w2 = cos((q.x + q.y) * 18.0 + ph * 0.5);
  var ink = smoothstep(0.25, 0.65, w1 * 0.5 + 0.5) * 0.85;
  ink = max(ink, smoothstep(0.55, 0.9, w2) * (0.45 + 0.45 * dense));
  // radial petal medallion
  let r = length(lc - vec2f(0.5, 0.5));
  let a = atan2(lc.y - 0.5, lc.x - 0.5);
  let petal = 0.16 + 0.08 * cos(a * 8.0 + ph);
  ink = max(ink, (1.0 - smoothstep(0.012, 0.05, abs(r - petal))) * 0.95);
  ink = max(ink, (1.0 - smoothstep(0.03, 0.05, r)) * 0.9);
  // thin frame line inside the tile edge
  let fr = max(q.x, q.y);
  ink = max(ink, (1.0 - smoothstep(0.008, 0.03, abs(fr - 0.44))) * 0.9);
  // brush density wobble so the blue reads hand-painted
  let wob = fbm(lc.x * 9.0 + seed, lc.y * 9.0 + cell.x * 3.0, 3.0) * 0.5 + 0.5;
  var col = mix(paper, cobalt, ink * (0.55 + 0.5 * wob));
  // grout + aging
  let ge = min(min(lc.x, 1.0 - lc.x), min(lc.y, 1.0 - lc.y));
  col = mix(vec3f(0.55, 0.53, 0.48), col, smoothstep(0.006, 0.025, ge));
  col = mix(col, vec3f(0.62, 0.55, 0.38), crack_field(uv, seed, 8.0) * (0.3 + 0.4 * step(0.5, variant) - 0.3 * step(1.5, variant)));
  col = col - vec3f(speckle(px, 1.6, seed, 0.95) * 0.07);
  return sat3(col);
}
