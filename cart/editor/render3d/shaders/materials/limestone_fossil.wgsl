// @material limestone_fossil
// @slug limestone-fossil
// @name Fossil Limestone
// @board wood_brick_stone
// @variant-labels Cream Quarry, Grey Reef, Shell Hash
// @kind surface
// @tags wood_brick_stone, limestone, fossil, stone
// @author fable-geology
fn limestone_fossil(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var base = vec3f(0.78, 0.73, 0.62);
  var mottle = vec3f(0.64, 0.58, 0.46);
  var shell = vec3f(0.90, 0.87, 0.78);
  var num = 4.0;
  if (variant > 0.5 && variant < 1.5) {
    base = vec3f(0.62, 0.62, 0.58);
    mottle = vec3f(0.48, 0.48, 0.44);
    shell = vec3f(0.80, 0.80, 0.74);
    num = 5.0;
  } else if (variant >= 1.5) {
    base = vec3f(0.74, 0.68, 0.55);
    mottle = vec3f(0.58, 0.52, 0.40);
    shell = vec3f(0.93, 0.89, 0.80);
    num = 8.0;
  }
  let mot = fbm(uv.x * 6.0 + seed * 0.6, uv.y * 6.0 - seed * 0.4, 3.0);
  var col = mix(base, mottle, smoothstep(-0.2, 0.35, mot));
  var fossil = 0.0;
  var pit = 0.0;
  for (var i = 0; i < 8; i = i + 1) {
    let fi = f32(i);
    if (fi >= num) { break; }
    let c = vec2f(rand(vec2f(fi * 2.3, seed * 0.07)), rand(vec2f(fi * 5.1 + 9.0, seed * 0.11)));
    let q = uv - c;
    let rr = length(q);
    let coil = smoothstep(0.014, 0.005, abs(sin(rr * 62.0 + fi * 2.0)) * 0.08) * smoothstep(0.085, 0.045, rr);
    fossil = max(fossil, coil);
    pit = max(pit, smoothstep(0.012, 0.004, rr));
  }
  col = mix(col, shell, fossil * 0.85);
  col = mix(col, mottle * 0.6, pit * 0.7);
  let grain = fbm(uv.x * 34.0 - seed, uv.y * 34.0, 3.0);
  col = col * (0.93 + grain * 0.22);
  col = mix(col, shell, speckle(px, 2.0, seed + 3.0, 0.975) * 0.4);
  return sat3(col);
}
