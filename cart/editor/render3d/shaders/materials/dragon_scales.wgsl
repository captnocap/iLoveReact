// @material dragon_scales
// @slug dragon-scales
// @name Dragon Scales
// @board props
// @variant-labels Wyrm Green, Ember Wyvern, Obsidian Elder
// @kind surface
// @tags props, scales, mythic
// @author fable-creature_skins
fn dragon_scales(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var platec = vec3f(0.18, 0.34, 0.16);
  var gapc = vec3f(0.05, 0.08, 0.04);
  var ridgec = vec3f(0.55, 0.72, 0.38);
  var emberc = vec3f(0.30, 0.40, 0.22);
  if (variant > 0.5 && variant < 1.5) {
    platec = vec3f(0.34, 0.14, 0.10);
    gapc = vec3f(0.90, 0.35, 0.05);
    ridgec = vec3f(0.75, 0.38, 0.20);
    emberc = vec3f(0.98, 0.65, 0.20);
  } else if (variant >= 1.5) {
    platec = vec3f(0.12, 0.12, 0.15);
    gapc = vec3f(0.03, 0.03, 0.05);
    ridgec = vec3f(0.42, 0.44, 0.52);
    emberc = vec3f(0.24, 0.26, 0.34);
  }
  let p = vec2f(uv.x * 6.0 + seed * 0.13, uv.y * 8.0 - seed * 0.07);
  let row = floor(p.y);
  let fx = fract(p.x + fract(row * 0.5));
  let fy = fract(p.y);
  let cid = vec2f(floor(p.x + fract(row * 0.5)), row);
  let pt = abs(fx - 0.5) * 1.6 + fy * 0.9;
  let inside = 1.0 - smoothstep(0.82, 0.95, pt);
  let tone = rand(cid + seed);
  let scar = crack_field(vec2f(fx, fy), seed + cid.x + cid.y, 3.0);
  var col = mix(gapc, platec * (0.80 + tone * 0.40), inside);
  let ridge = line_near(fx - 0.5, 0.06) * inside * smoothstep(0.9, 0.2, fy);
  col = mix(col, ridgec, ridge * 0.85);
  let horn = step(0.72, rand(cid * 1.9 + seed)) * (1.0 - smoothstep(0.0, 0.25, length(vec2f(fx - 0.5, fy - 0.30))));
  col = mix(col, ridgec * 1.25, horn);
  col = col - vec3f(0.10, 0.09, 0.08) * scar * inside * 0.6;
  col = col + emberc * (1.0 - inside) * 0.5;
  col = col - vec3f(0.08, 0.08, 0.07) * smoothstep(0.6, 0.95, fy) * inside;
  return sat3(col);
}
