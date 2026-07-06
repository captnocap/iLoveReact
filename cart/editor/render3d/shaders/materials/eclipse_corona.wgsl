// @material eclipse_corona
// @slug eclipse-corona
// @name Eclipse Corona
// @board gradients
// @variant-labels Totality, Diamond Ring, Annular Fire
// @kind composition
// @tags gradients, eclipse, corona, sun
// @author fable-sky_space
fn eclipse_corona(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var sky = vec3f(0.02, 0.02, 0.05);
  var coronaCol = vec3f(0.90, 0.92, 0.98);
  var rimCol = vec3f(0.95, 0.35, 0.25);
  let ctr = vec2f(0.5, 0.52);
  let d = uv - ctr;
  let r = length(d);
  let ang = atan2(d.y, d.x);
  let discR = 0.20;
  var col = sky + vec3f(0.02, 0.02, 0.04) * (fbm(uv.x * 3.0 + seed, uv.y * 3.0, 3.0) + 0.5);
  let streamer = fbm(cos(ang) * 2.5 + seed, sin(ang) * 2.5 - seed * 0.3, 4.0) + 0.5;
  var glow = exp(-(r - discR) * 7.5) * (0.35 + streamer * 1.1) * step(discR * 0.6, r);
  if (variant > 0.5 && variant < 1.5) {
    let sparkAng = fract(seed * 0.23) * 6.28;
    let sparkPos = ctr + vec2f(cos(sparkAng), sin(sparkAng)) * discR;
    col = col + vec3f(0.99, 0.97, 0.88) * (exp(-length(uv - sparkPos) * 26.0) * 2.2 + dot_mark(uv, sparkPos, 0.014) * 1.5);
    glow = glow * 0.55;
  } else if (variant >= 1.5) {
    coronaCol = vec3f(0.98, 0.72, 0.35);
    rimCol = vec3f(0.99, 0.85, 0.45);
    let ringBand = smoothstep(0.010, 0.002, abs(r - discR - 0.012));
    col = col + vec3f(0.99, 0.90, 0.60) * ringBand * 1.6;
    glow = glow * 0.5;
  }
  col = col + coronaCol * sat(glow);
  let chromo = smoothstep(0.014, 0.003, abs(r - discR)) * (0.4 + streamer * 0.6);
  col = col + rimCol * chromo;
  col = mix(col, vec3f(0.01, 0.01, 0.02), smoothstep(discR + 0.004, discR - 0.006, r));
  col = col + vec3f(0.80, 0.84, 0.92) * speckle(px, 1.2, seed, 0.985) * smoothstep(discR + 0.1, discR + 0.3, r);
  return sat3(col);
}
