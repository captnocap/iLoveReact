// @material corrugated_metal
// @slug corrugated-metal
// @name Corrugated Metal
// @board metal_yard
// @variant-labels Galvanized, Rust Bottom, Painted Blue
// @kind surface
// @tags metal_yard, corrugated, metal
// @author legacy
fn corrugated_metal(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let rib = sin(uv.x * 90.0);
  var col = mix(vec3f(0.36, 0.38, 0.38), vec3f(0.72, 0.74, 0.72), rib * 0.5 + 0.5);
  col = col + vec3f((fbm(uv.x * 18.0, uv.y * 18.0 + seed, 4.0) - 0.5) * 0.08);
  if (variant > 0.5 && variant < 1.5) { col = mix(col, vec3f(0.54, 0.20, 0.08), smoothstep(0.60, 1.0, uv.y) * 0.55); }
  else if (variant >= 1.5) { col = mix(col, vec3f(0.12, 0.28, 0.56), 0.50); col = mix(col, vec3f(0.85, 0.85, 0.78), crack_field(uv, seed, 8.0) * 0.35); }
  return sat3(col);
}
