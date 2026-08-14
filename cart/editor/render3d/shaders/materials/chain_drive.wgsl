// @material chain_drive
// @slug chain-drive
// @name Chain Drive
// @board metal_yard
// @variant-labels Oiled Fresh, Dry Dusty, Rust Locked
// @kind surface
// @tags metal_yard, chain, sprocket, drive
// @author fable-machine_yard
fn chain_drive(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var linkTone = vec3f(0.52, 0.53, 0.56);
  var pinTone = vec3f(0.70, 0.71, 0.74);
  var bgTone = vec3f(0.10, 0.09, 0.08);
  var oil = 0.7;
  if (variant > 0.5 && variant < 1.5) {
    linkTone = vec3f(0.46, 0.44, 0.40);
    pinTone = vec3f(0.60, 0.58, 0.52);
    bgTone = vec3f(0.16, 0.15, 0.13);
    oil = 0.15;
  } else if (variant >= 1.5) {
    linkTone = vec3f(0.42, 0.25, 0.14);
    pinTone = vec3f(0.55, 0.35, 0.18);
    bgTone = vec3f(0.11, 0.08, 0.06);
    oil = 0.3;
  }
  var col = bgTone * (0.7 + 0.6 * (fbm(uv.x * 5.0 + seed, uv.y * 5.0, 3.0) * 0.5 + 0.5));
  let phase = fract(seed * 0.219);
  var chainMask = 0.0;
  var chainCol = vec3f(0.0, 0.0, 0.0);
  for (var i = 0; i < 2; i = i + 1) {
    let cy = 0.28 + f32(i) * 0.44;
    let band = 1.0 - smoothstep(0.055, 0.075, abs(uv.y - cy));
    let lx = fract(uv.x * 9.0 + phase + f32(i) * 0.5);
    let alt = step(0.5, fract(floor(uv.x * 9.0 + phase + f32(i) * 0.5) * 0.5));
    let plateH = 0.045 + alt * 0.018;
    let plate = 1.0 - smoothstep(plateH, plateH + 0.012, abs(uv.y - cy));
    let side = smoothstep(0.04, 0.10, lx) * (1.0 - smoothstep(0.90, 0.96, lx));
    let linkM = plate * side;
    var tone = linkTone * (0.55 + 0.5 * sin((uv.y - cy + 0.06) * 26.0));
    let pinD = length(vec2f((lx - 0.5) * 0.111, uv.y - cy));
    let pin = 1.0 - smoothstep(0.012, 0.018, pinD);
    tone = mix(tone, pinTone, pin);
    chainCol = mix(chainCol, tone, linkM * band);
    chainMask = max(chainMask, linkM * band);
  }
  col = mix(col, chainCol, chainMask);
  let gloss = pow(fbm(uv.x * 14.0, uv.y * 14.0 + seed, 2.0) * 0.5 + 0.5, 2.0);
  col = col + vec3f(0.25, 0.25, 0.23) * gloss * chainMask * oil;
  col = mix(col, vec3f(0.07, 0.06, 0.04), vertical_drips(uv, seed + 3.0, 0.5) * oil * 0.5);
  col = col + vec3f(0.2, 0.2, 0.18) * speckle(px, 2.0, seed, 0.992) * 0.4;
  return sat3(col);
}
