// @material sunflower_field
// @slug sunflower-field
// @name Sunflower Field
// @board environment
// @variant-labels Full Sun, Young Rows, Autumn Droop
// @kind composition
// @tags environment, sunflower, farm
// @author fable-botanic
fn sunflower_field(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let clump = fbm(uv.x * 6.0 + seed, uv.y * 6.0, 4.0) * 0.5 + 0.5;
  var leaf_lo = vec3f(0.07, 0.20, 0.07);
  var leaf_hi = vec3f(0.20, 0.44, 0.12);
  var petal = vec3f(0.96, 0.78, 0.16);
  var core_c = vec3f(0.28, 0.17, 0.07);
  var scale = 4.0;
  var radius = 0.34;
  var keep = 0.15;
  if (variant > 0.5 && variant < 1.5) {
    leaf_lo = vec3f(0.10, 0.26, 0.10);
    leaf_hi = vec3f(0.30, 0.55, 0.18);
    petal = vec3f(0.92, 0.84, 0.34);
    scale = 6.0;
    radius = 0.24;
    keep = 0.45;
  } else if (variant >= 1.5) {
    leaf_lo = vec3f(0.15, 0.16, 0.06);
    leaf_hi = vec3f(0.36, 0.36, 0.14);
    petal = vec3f(0.78, 0.58, 0.16);
    core_c = vec3f(0.18, 0.11, 0.05);
    scale = 4.5;
    radius = 0.30;
    keep = 0.30;
  }
  var col = mix(leaf_lo, leaf_hi, clump);
  let stalk = line_near(sin(uv.x * 70.0 + seed), 0.22);
  col = mix(col, leaf_lo * 0.7, stalk * 0.5);
  let g = uv * scale + vec2f(seed * 0.37, seed * 0.11);
  let cell = floor(g);
  let jit = vec2f(rand(cell + vec2f(seed, 1.0)), rand(cell + vec2f(2.0, seed))) * 0.4 + vec2f(0.3);
  let d = g - cell - jit;
  let ang = atan2(d.y, d.x);
  let rr = length(d);
  let present = step(keep, rand(cell * 1.7 + vec2f(seed * 0.5, 3.0)));
  let pet_r = radius * (0.72 + 0.28 * abs(sin(ang * 6.0 + seed)));
  let headmask = smoothstep(pet_r, pet_r - 0.06, rr) * present;
  let coremask = smoothstep(radius * 0.45, radius * 0.38, rr) * present;
  col = mix(col, petal, headmask);
  let core_tx = rand(floor(px / 3.0) + vec2f(seed, 0.0)) * 0.25;
  col = mix(col, core_c + vec3f(core_tx * 0.5, core_tx * 0.3, 0.02), coremask);
  return sat3(col);
}
