// @material jam_toast
// @slug jam-toast
// @name Jam Toast
// @board props
// @variant-labels Strawberry Smear, Blueberry Morning, Marmalade Shine
// @kind composition
// @tags props, toast, jam, breakfast
// @author fable-food
fn jam_toast(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var crumbTone = vec3f(0.93, 0.80, 0.55);
  var crust = vec3f(0.55, 0.30, 0.12);
  var jam = vec3f(0.78, 0.14, 0.20);
  var jamDeep = vec3f(0.56, 0.06, 0.12);
  if (variant > 0.5 && variant < 1.5) {
    jam = vec3f(0.30, 0.18, 0.52);
    jamDeep = vec3f(0.18, 0.09, 0.36);
  } else if (variant >= 1.5) {
    jam = vec3f(0.94, 0.52, 0.10);
    jamDeep = vec3f(0.76, 0.34, 0.04);
  }
  let toastNoise = fbm(uv.x * 10.0 + seed, uv.y * 10.0, 4.0) * 0.5 + 0.5;
  var col = crumbTone * (0.82 + toastNoise * 0.3);
  let scorch = smoothstep(0.62, 0.9, toastNoise);
  col = mix(col, vec3f(0.72, 0.50, 0.24), scorch * 0.55);
  let pore = speckle(px, 3.0, seed + 2.0, 0.92);
  col = mix(col, vec3f(0.70, 0.54, 0.32), pore * 0.45);
  let inX = smoothstep(0.03, 0.10, uv.x) * smoothstep(0.97, 0.90, uv.x);
  let inY = smoothstep(0.03, 0.10, uv.y) * smoothstep(0.97, 0.90, uv.y);
  let crustBand = 1.0 - inX * inY;
  col = mix(col, crust, crustBand * 0.9);
  let smear = fbm(uv.x * 6.0 + seed * 1.3, uv.y * 6.0, 3.0) * 0.5 + 0.5;
  let jamBlob = blotch(uv, vec2f(0.5, 0.48), 0.30, vec2f(0.85, 0.85), seed + 7.0);
  let jamMask = sat(jamBlob * 1.3 + (smear - 0.5) * 0.5) * inX * inY;
  let jamSolid = smoothstep(0.25, 0.55, jamMask);
  var jamCol = mix(jamDeep, jam, smear);
  let seedFleck = speckle(px, 2.0, seed + 11.0, 0.96);
  jamCol = mix(jamCol, vec3f(0.95, 0.85, 0.50), seedFleck * 0.6);
  col = mix(col, jamCol, jamSolid);
  let gleam = smoothstep(0.72, 0.94, smear) * jamSolid;
  col = mix(col, jam * 1.45, gleam * 0.5);
  let knifeTrack = line_near(sin((uv.y - 0.48) * 22.0 + seed), 0.2) * jamSolid;
  col = mix(col, jamDeep, knifeTrack * 0.3);
  return sat3(col);
}
