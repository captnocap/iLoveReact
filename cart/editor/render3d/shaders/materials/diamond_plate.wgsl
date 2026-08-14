// @material diamond_plate
// @slug diamond-plate
// @name Diamond Plate
// @board metal_yard
// @variant-labels Clean, Greasy, Worn Edge
// @kind surface
// @tags metal_yard, diamond, plate
// @author legacy
fn diamond_plate(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = mix(vec3f(0.32, 0.32, 0.31), vec3f(0.72, 0.72, 0.68), fbm(uv.x * 18.0, uv.y * 18.0, 4.0) * 0.5 + 0.5);
  let a = line_near(sin((uv.x + uv.y) * 52.0), 0.10);
  let b = line_near(sin((uv.x - uv.y) * 52.0), 0.10);
  let raised = a * b;
  base = base + vec3f(0.20) * raised;
  if (variant > 0.5 && variant < 1.5) { base = mix(base, vec3f(0.05, 0.045, 0.04), blotch(uv, vec2f(0.55, 0.36), 0.22, vec2f(1.5, 0.7), seed) * 0.42); }
  else if (variant >= 1.5) { base = mix(base, vec3f(0.80, 0.72, 0.56), smoothstep(0.0, 0.20, uv.x) * 0.35); }
  return sat3(base);
}
