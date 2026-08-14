// @material candy_corn
// @slug candy-corn
// @name Candy Corn
// @board props
// @variant-labels October Pile, Harvest Brown, Neon Bag
// @kind surface
// @tags props, candy, halloween, corn
// @author fable-food
fn candy_corn(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var bg = vec3f(0.20, 0.10, 0.24);
  var baseBand = vec3f(0.97, 0.78, 0.14);
  var midBand = vec3f(0.96, 0.50, 0.08);
  var tipBand = vec3f(0.97, 0.94, 0.88);
  if (variant > 0.5 && variant < 1.5) {
    bg = vec3f(0.14, 0.09, 0.06);
    baseBand = vec3f(0.62, 0.36, 0.14);
    midBand = vec3f(0.90, 0.62, 0.20);
    tipBand = vec3f(0.94, 0.88, 0.76);
  } else if (variant >= 1.5) {
    bg = vec3f(0.08, 0.05, 0.16);
    baseBand = vec3f(0.30, 0.95, 0.55);
    midBand = vec3f(0.95, 0.25, 0.65);
    tipBand = vec3f(0.98, 0.96, 0.60);
  }
  let cols = 5.0;
  let rows = 4.0;
  let row = floor(uv.y * rows);
  let offx = (row - floor(row * 0.5) * 2.0) * 0.5;
  let guv = vec2f(uv.x * cols + offx, uv.y * rows);
  let cell = floor(guv);
  var local = fract(guv) - vec2f(0.5, 0.5);
  let flip = step(0.5, rand(cell + vec2f(seed, 3.0)));
  local.y = local.y * (1.0 - flip * 2.0);
  let tilt = (rand(cell + vec2f(seed, 8.0)) - 0.5) * 0.5;
  let lx = local.x + local.y * tilt;
  let ky = local.y + 0.5;
  let halfw = mix(0.34, 0.06, sat(ky));
  let kernel = 1.0 - smoothstep(halfw - 0.03, halfw, abs(lx));
  let inKernel = kernel * step(0.06, ky) * step(ky, 0.96);
  var kcol = baseBand;
  if (ky > 0.42 && ky <= 0.70) { kcol = midBand; }
  if (ky > 0.70) { kcol = tipBand; }
  let waxy = 1.0 - smoothstep(0.0, halfw, abs(lx));
  kcol = kcol * (0.78 + waxy * 0.32);
  var col = bg * (0.85 + (fbm(uv.x * 6.0 + seed, uv.y * 6.0, 2.0) * 0.5 + 0.5) * 0.3);
  col = mix(col, vec3f(0.03, 0.02, 0.05), (1.0 - inKernel) * 0.25);
  col = mix(col, kcol, inKernel);
  let gloss = dot_mark(vec2f(lx, ky), vec2f(-0.08, 0.30), 0.06) * inKernel;
  col = mix(col, vec3f(1.0, 0.98, 0.92), gloss * 0.5);
  let dust = speckle(px, 2.0, seed + 4.0, 0.975);
  col = mix(col, tipBand, dust * 0.35);
  return sat3(col);
}
