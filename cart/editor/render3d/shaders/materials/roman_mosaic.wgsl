// @material roman_mosaic
// @slug roman-mosaic
// @name Roman Mosaic
// @board wood_brick_stone
// @variant-labels Villa Border, Bath House, Buried Ochre
// @kind surface
// @tags wood_brick_stone, tesserae, roman, border
// @author fable-mosaic_tile
fn roman_mosaic(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let ts = 18.0;
  let cell = floor(uv * ts);
  let jit = (rand(cell + vec2f(seed * 0.19, seed * 0.07)) - 0.5) * 0.16;
  let lc = fract(uv * ts + vec2f(jit, jit * 0.7));
  let tone = rand(cell + vec2f(seed * 0.31, 4.2));
  var stone = mix(vec3f(0.80, 0.76, 0.66), vec3f(0.90, 0.87, 0.78), tone);
  var bandCol = vec3f(0.48, 0.16, 0.12);
  var lineCol = vec3f(0.14, 0.13, 0.12);
  var waveCol = vec3f(0.72, 0.54, 0.24);
  if (variant > 0.5 && variant < 1.5) {
    stone = mix(vec3f(0.74, 0.78, 0.76), vec3f(0.86, 0.89, 0.86), tone);
    bandCol = vec3f(0.16, 0.30, 0.42);
    waveCol = vec3f(0.30, 0.52, 0.55);
  } else if (variant >= 1.5) {
    stone = mix(vec3f(0.70, 0.63, 0.50), vec3f(0.82, 0.75, 0.60), tone);
    bandCol = vec3f(0.36, 0.24, 0.14);
    lineCol = vec3f(0.24, 0.20, 0.15);
    waveCol = vec3f(0.60, 0.42, 0.20);
  }
  var col = stone;
  // border architecture read off tesserae row position
  let ry = uv.y;
  let inBand = step(0.08, ry) * (1.0 - step(0.17, ry)) + step(0.83, ry) * (1.0 - step(0.92, ry));
  let inLine = step(0.03, ry) * (1.0 - step(0.065, ry)) + step(0.935, ry) * (1.0 - step(0.97, ry));
  col = mix(col, bandCol * (0.8 + 0.4 * tone), inBand);
  col = mix(col, lineCol * (0.8 + 0.5 * tone), inLine);
  // guilloche wave through the middle field
  let wave = abs(ry - (0.5 + 0.13 * sin(uv.x * 12.566 + seed * 0.7)));
  col = mix(col, waveCol * (0.75 + 0.45 * tone), (1.0 - smoothstep(0.045, 0.07, wave)));
  // mortar gaps between tesserae
  let ge = min(min(lc.x, 1.0 - lc.x), min(lc.y, 1.0 - lc.y));
  col = mix(vec3f(0.52, 0.49, 0.43), col, smoothstep(0.02, 0.09, ge));
  // dirt sitting in the field
  let dirt = fbm(uv.x * 5.0 + seed * 0.3, uv.y * 5.0, 3.0) * 0.5 + 0.5;
  col = mix(col, vec3f(0.42, 0.38, 0.30), smoothstep(0.55, 0.9, dirt) * 0.30);
  col = col - vec3f(speckle(px, 1.7, seed, 0.94) * 0.09);
  return sat3(col);
}
