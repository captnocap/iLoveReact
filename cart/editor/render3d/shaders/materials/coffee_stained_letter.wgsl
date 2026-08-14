// @material coffee_stained_letter
// @slug coffee-stained-letter
// @name Coffee Stained Letter
// @board wallpapers
// @variant-labels One Ring, Double Ring, Full Spill
// @kind composition
// @tags wallpapers, letter, coffee, stain
// @author fable-paper_print
fn coffee_stained_letter(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let paper = vec3f(0.92, 0.90, 0.83);
  let ink = vec3f(0.24, 0.23, 0.26);
  let coffee = vec3f(0.52, 0.36, 0.20);
  var col = paper * (0.96 + 0.04 * (fbm(uv.x * 28.0, uv.y * 28.0 + seed, 2.0) + 0.5));
  let head = step(fract(uv.y * 20.0), 0.4) * step(0.08, uv.y) * step(uv.y, 0.16) * step(0.32, uv.x) * step(uv.x, 0.68);
  col = mix(col, ink, head * 0.7);
  let row = floor(uv.y * 34.0);
  let rl = fract(uv.y * 34.0);
  let para = step(0.22, uv.y) * step(uv.y, 0.82);
  let indent = 0.10 + step(fract(row * 0.125), 0.01) * 0.06;
  let linelen = 0.88 - rand(vec2f(row, seed)) * 0.12;
  let gap = step(rand(vec2f(row * 13.0 + floor(uv.x * 26.0), seed + 1.0)), 0.86);
  let blank = step(0.25, fract(row * 0.14 + rand(vec2f(row, seed + 2.0)) * 0.02));
  let body = step(rl, 0.42) * para * step(indent, uv.x) * step(uv.x, linelen) * gap * blank;
  col = mix(col, ink, body * 0.72);
  let sig = line_near(uv.y - 0.885 - 0.02 * sin(uv.x * 40.0 + seed), 0.012) * step(0.58, uv.x) * step(uv.x, 0.86);
  col = mix(col, ink, sig * 0.7);
  let rc = vec2f(0.30 + rand(vec2f(seed, 3.0)) * 0.35, 0.30 + rand(vec2f(seed, 4.0)) * 0.35);
  let wob = (snoise(atan2(uv.y - rc.y, uv.x - rc.x) * 3.0, seed) * 0.5 + 0.5) * 0.02;
  let rr = length((uv - rc) * vec2f(1.0, 1.15));
  let ring = smoothstep(0.020, 0.006, abs(rr - 0.13 - wob));
  col = mix(col, coffee, ring * 0.55);
  col = mix(col, coffee, smoothstep(0.13, 0.02, rr) * 0.10);
  if (variant > 0.5 && variant < 1.5) {
    let rc2 = rc + vec2f(0.16, 0.28);
    let rr2 = length((uv - rc2) * vec2f(1.1, 1.0));
    col = mix(col, coffee, smoothstep(0.018, 0.005, abs(rr2 - 0.10 - wob)) * 0.50);
    col = mix(col, coffee * 0.9, smoothstep(0.10, 0.03, rr2) * 0.12);
  } else if (variant >= 1.5) {
    let spill = blotch(uv, vec2f(0.62, 0.62), 0.24, vec2f(1.3, 1.3), seed) ;
    col = mix(col, coffee * 0.85, spill * 0.45);
    col = mix(col, coffee * 0.6, blotch(uv, vec2f(0.70, 0.72), 0.10, vec2f(1.1, 1.1), seed + 5.0) * 0.5);
    let drips = vertical_drips(uv, seed, 0.5);
    col = mix(col, coffee, drips * 0.25);
  }
  col = col - vec3f(speckle(px, 3.0, seed + 7.0, 0.99) * 0.08);
  return sat3(col);
}
