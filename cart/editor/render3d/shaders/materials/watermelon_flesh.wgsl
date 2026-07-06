// @material watermelon_flesh
// @slug watermelon-flesh
// @name Watermelon Flesh
// @board props
// @variant-labels Summer Ripe, Pale Crisp, Sunset Yellow
// @kind surface
// @tags props, watermelon, fruit, summer
// @author fable-food
fn watermelon_flesh(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var flesh = vec3f(0.94, 0.28, 0.30);
  var fleshLo = vec3f(0.78, 0.16, 0.20);
  var rindPale = vec3f(0.90, 0.96, 0.84);
  var rindGreen = vec3f(0.22, 0.52, 0.22);
  if (variant > 0.5 && variant < 1.5) {
    flesh = vec3f(0.96, 0.52, 0.50);
    fleshLo = vec3f(0.86, 0.36, 0.36);
    rindPale = vec3f(0.92, 0.97, 0.88);
    rindGreen = vec3f(0.32, 0.62, 0.30);
  } else if (variant >= 1.5) {
    flesh = vec3f(0.97, 0.78, 0.26);
    fleshLo = vec3f(0.88, 0.62, 0.16);
    rindPale = vec3f(0.94, 0.96, 0.82);
    rindGreen = vec3f(0.26, 0.55, 0.24);
  }
  let pulp = fbm(uv.x * 8.0 + seed, uv.y * 8.0, 4.0) * 0.5 + 0.5;
  var col = mix(fleshLo, flesh, pulp);
  let streak = fbm(uv.x * 3.0 + seed * 0.7, uv.y * 16.0, 3.0) * 0.5 + 0.5;
  col = mix(col, flesh * 1.12, smoothstep(0.6, 0.85, streak) * 0.4);
  let guv = vec2f(uv.x * 5.0, uv.y * 4.0);
  let cell = floor(guv);
  let jit = vec2f(rand(cell + vec2f(seed, 2.0)) - 0.5, rand(cell + vec2f(6.0, seed)) - 0.5) * 0.4;
  let local = fract(guv) - vec2f(0.5, 0.5) - jit;
  let sd = length(local * vec2f(1.6, 1.0));
  let hasSeed = step(0.35, rand(cell + vec2f(seed, 9.0))) * step(uv.y, 0.72);
  let seedMask = (1.0 - smoothstep(0.09, 0.115, sd)) * hasSeed;
  col = mix(col, vec3f(0.10, 0.07, 0.05), seedMask);
  col = mix(col, vec3f(0.85, 0.80, 0.72), dot_mark(local + vec2f(0.03, 0.03), vec2f(0.0, 0.0), 0.028) * hasSeed * seedMask);
  let rindLine = smoothstep(0.80, 0.84, uv.y);
  let deepRind = smoothstep(0.88, 0.93, uv.y);
  col = mix(col, rindPale, rindLine);
  var greenCol = rindGreen;
  let stripe2 = sin(uv.x * 40.0 + seed) * 0.5 + 0.5;
  greenCol = mix(greenCol, rindGreen * 0.6, step(0.5, stripe2));
  col = mix(col, greenCol, deepRind);
  let juice = speckle(px, 3.0, seed + 4.0, 0.96) * (1.0 - rindLine);
  col = mix(col, vec3f(0.99, 0.86, 0.84), juice * 0.4);
  return sat3(col);
}
