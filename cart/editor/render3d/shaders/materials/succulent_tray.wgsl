// @material succulent_tray
// @slug succulent-tray
// @name Succulent Tray
// @board environment
// @variant-labels Nursery Mix, Jade Wall, Blushing Tips
// @kind composition
// @tags environment, succulent, planter
// @author fable-botanic
fn succulent_tray(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var soil_c = vec3f(0.16, 0.11, 0.08);
  var ros_a = vec3f(0.22, 0.44, 0.26);
  var ros_b = vec3f(0.36, 0.52, 0.40);
  var ros_c2 = vec3f(0.42, 0.34, 0.48);
  var tip_c = vec3f(0.82, 0.40, 0.42);
  var tip_amt = 0.35;
  if (variant > 0.5 && variant < 1.5) {
    soil_c = vec3f(0.13, 0.10, 0.08);
    ros_a = vec3f(0.16, 0.36, 0.18);
    ros_b = vec3f(0.26, 0.46, 0.24);
    ros_c2 = vec3f(0.34, 0.50, 0.30);
    tip_amt = 0.10;
  } else if (variant >= 1.5) {
    soil_c = vec3f(0.20, 0.14, 0.10);
    ros_a = vec3f(0.30, 0.44, 0.30);
    ros_b = vec3f(0.48, 0.42, 0.50);
    ros_c2 = vec3f(0.56, 0.58, 0.44);
    tip_c = vec3f(0.88, 0.32, 0.38);
    tip_amt = 0.85;
  }
  let v = voronoi(uv.x * 6.5 + seed * 0.6, uv.y * 6.5 + seed * 0.3);
  let h = fract(v.y * 7.13);
  var body = ros_a;
  if (h > 0.33 && h < 0.66) { body = ros_b; }
  else if (h >= 0.66) { body = ros_c2; }
  let rosette = smoothstep(0.52, 0.44, v.x);
  let ring = 0.5 + 0.5 * sin(v.x * 46.0 + h * 6.0);
  var leafcol = mix(body * 0.62, body * 1.15, ring);
  let tipm = smoothstep(0.55, 0.85, ring) * smoothstep(0.20, 0.42, v.x);
  leafcol = mix(leafcol, tip_c, tipm * tip_amt);
  let heart = smoothstep(0.10, 0.02, v.x);
  leafcol = mix(leafcol, body * 1.35 + vec3f(0.08, 0.10, 0.06), heart);
  var col = mix(soil_c, leafcol, rosette);
  let grit = speckle(px, 2.0, seed + 4.0, 0.88);
  col = mix(col, vec3f(0.42, 0.36, 0.30), grit * (1.0 - rosette) * 0.8);
  let dust = fbm(uv.x * 12.0 + seed, uv.y * 12.0, 3.0) * 0.5 + 0.5;
  col = col * (0.86 + dust * 0.24);
  return sat3(col);
}
