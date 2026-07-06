// @material radiator_ribs
// @slug radiator-ribs
// @name Radiator Ribs
// @board liminal
// @variant-labels Cream Enamel, Silver Paint, Rust Weeper
// @kind surface
// @tags liminal, radiator, iron, heating
// @author fable-interior_home
fn radiator_ribs(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var body = vec3f(0.85, 0.82, 0.72);
  var deep = vec3f(0.45, 0.42, 0.35);
  var rust = vec3f(0.48, 0.26, 0.12);
  var rust_amt = 0.35;
  if (variant > 0.5 && variant < 1.5) {
    body = vec3f(0.68, 0.70, 0.74);
    deep = vec3f(0.34, 0.36, 0.40);
    rust = vec3f(0.42, 0.24, 0.14);
    rust_amt = 0.2;
  } else if (variant >= 1.5) {
    body = vec3f(0.52, 0.44, 0.36);
    deep = vec3f(0.24, 0.20, 0.16);
    rust = vec3f(0.55, 0.28, 0.10);
    rust_amt = 0.95;
  }
  let rib = fract(uv.x * 9.0 + fract(seed * 0.05));
  let prof = sin(rib * 3.14159);
  let gap = 1.0 - smoothstep(0.0, 0.10, min(rib, 1.0 - rib));
  var col = mix(deep, body, prof);
  col = mix(col, deep * 0.6, gap);
  col = col + vec3f(0.10) * line_near(rib - 0.42, 0.09) * smoothstep(0.9, 0.1, uv.y);
  let header = 1.0 - smoothstep(0.10, 0.13, uv.y);
  col = mix(col, body * 0.92, header);
  col = mix(col, deep, line_near(uv.y - 0.125, 0.012) * 0.9);
  let drips = vertical_drips(uv, seed, 0.55) * smoothstep(0.15, 0.7, uv.y);
  col = mix(col, rust, drips * rust_amt);
  let blister = speckle(px, 3.0, seed + 1.0, 0.96);
  col = mix(col, rust * 0.8, blister * rust_amt);
  col = mix(col, deep * 0.8, smoothstep(0.85, 1.0, uv.y) * 0.5);
  let dust = fbm(uv.x * 12.0, uv.y * 3.0 + seed, 3.0) * 0.5 + 0.5;
  col = col + vec3f((dust - 0.5) * 0.05);
  return sat3(col);
}
