// @material mermaid_scales
// @slug mermaid-scales
// @name Mermaid Scales
// @board props
// @variant-labels Lagoon Teal, Abyss Violet, Pearl Dawn
// @kind surface
// @tags props, scales, iridescent
// @author fable-creature_skins
fn mermaid_scales(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var deepc = vec3f(0.04, 0.22, 0.28);
  var scalec = vec3f(0.12, 0.55, 0.58);
  var rimc = vec3f(0.55, 0.90, 0.85);
  var hueBase = 0.50;
  if (variant > 0.5 && variant < 1.5) {
    deepc = vec3f(0.10, 0.05, 0.22);
    scalec = vec3f(0.32, 0.16, 0.55);
    rimc = vec3f(0.75, 0.55, 0.95);
    hueBase = 0.75;
  } else if (variant >= 1.5) {
    deepc = vec3f(0.55, 0.48, 0.50);
    scalec = vec3f(0.85, 0.78, 0.78);
    rimc = vec3f(0.98, 0.92, 0.86);
    hueBase = 0.05;
  }
  let p = vec2f(uv.x * 8.0 + seed * 0.21, uv.y * 11.0 - seed * 0.15);
  let row = floor(p.y);
  let fx = fract(p.x + fract(row * 0.5));
  let fy = fract(p.y);
  let cid = vec2f(floor(p.x + fract(row * 0.5)), row);
  let arc = length(vec2f((fx - 0.5) * 1.15, (fy - 0.02) * 0.85));
  let inside = 1.0 - smoothstep(0.47, 0.55, arc);
  let rim = smoothstep(0.36, 0.47, arc) * inside;
  let tone = rand(cid + seed);
  var col = mix(deepc, scalec * (0.75 + tone * 0.5), inside);
  col = mix(col, rimc, rim * 0.8);
  let irid = hsv2rgb(fract(hueBase + tone * 0.18 + uv.y * 0.15 + seed * 0.02), 0.6, 1.0);
  col = col + irid * inside * 0.22 * pow(sat(sin((uv.x + uv.y) * 5.0 + seed * 0.1)), 3.0);
  col = col - vec3f(0.08, 0.10, 0.10) * smoothstep(0.6, 0.95, fy) * inside * 0.6;
  col = mix(col, rimc * 1.1, speckle(px, 2.0, seed, 0.97) * 0.6);
  return sat3(col);
}
