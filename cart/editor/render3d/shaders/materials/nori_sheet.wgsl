// @material nori_sheet
// @slug nori-sheet
// @name Nori Sheet
// @board props
// @variant-labels Deep Roast, Thin Patchy, Green Sea
// @kind surface
// @tags props, nori, seaweed, japanese
// @author fable-food
fn nori_sheet(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var deep = vec3f(0.05, 0.09, 0.06);
  var mid = vec3f(0.12, 0.20, 0.11);
  var thin = vec3f(0.30, 0.42, 0.16);
  var glint = vec3f(0.36, 0.44, 0.30);
  var patchy = 0.3;
  if (variant > 0.5 && variant < 1.5) {
    deep = vec3f(0.07, 0.10, 0.06);
    mid = vec3f(0.16, 0.24, 0.12);
    thin = vec3f(0.44, 0.52, 0.20);
    patchy = 0.8;
  } else if (variant >= 1.5) {
    deep = vec3f(0.04, 0.12, 0.10);
    mid = vec3f(0.09, 0.24, 0.17);
    thin = vec3f(0.22, 0.46, 0.28);
    glint = vec3f(0.30, 0.50, 0.42);
  }
  let fiberA = fbm(uv.x * 26.0 + seed, uv.y * 5.0, 3.0) * 0.5 + 0.5;
  let fiberB = fbm(uv.x * 4.0 + seed * 1.3, uv.y * 30.0, 3.0) * 0.5 + 0.5;
  let mottle = fbm(uv.x * 7.0 + seed * 0.6, uv.y * 7.0, 4.0) * 0.5 + 0.5;
  var col = mix(deep, mid, fiberA * 0.7 + fiberB * 0.3);
  col = mix(col, thin, smoothstep(0.66, 0.92, mottle) * patchy);
  let vein = line_near(sin(uv.y * 40.0 + fiberA * 6.0 + seed), 0.15);
  col = mix(col, mid * 1.3, vein * 0.25);
  let sparkle = speckle(px, 2.0, seed + 4.0, 0.965);
  col = mix(col, glint, sparkle * 0.6);
  let sheet = smoothstep(0.0, 0.06, uv.x) * smoothstep(1.0, 0.94, uv.x);
  col = col * (0.72 + sheet * 0.28);
  let shade = fbm(uv.x * 2.0 + seed, uv.y * 2.0, 2.0) * 0.5 + 0.5;
  col = col * (0.88 + shade * 0.24);
  return sat3(col);
}
