// @material gauge_cluster
// @slug gauge-cluster
// @name Gauge Cluster
// @board metal_yard
// @variant-labels Brass Works, Night Shift, Steam Era
// @kind composition
// @tags metal_yard, gauges, dials, needles
// @author fable-machine_yard
fn gauge_cluster(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var panelTone = vec3f(0.30, 0.31, 0.33);
  var faceTone = vec3f(0.88, 0.86, 0.78);
  var needleTone = vec3f(0.75, 0.15, 0.12);
  var rimTone = vec3f(0.62, 0.52, 0.28);
  if (variant > 0.5 && variant < 1.5) {
    panelTone = vec3f(0.14, 0.15, 0.17);
    faceTone = vec3f(0.10, 0.13, 0.12);
    needleTone = vec3f(0.95, 0.55, 0.15);
    rimTone = vec3f(0.45, 0.47, 0.50);
  } else if (variant >= 1.5) {
    panelTone = vec3f(0.35, 0.27, 0.19);
    faceTone = vec3f(0.80, 0.74, 0.60);
    needleTone = vec3f(0.12, 0.12, 0.14);
    rimTone = vec3f(0.70, 0.58, 0.30);
  }
  let nx = 3.0;
  let ny = 2.0;
  let cx = floor(uv.x * nx);
  let cy = floor(uv.y * ny);
  let lc = vec2f(fract(uv.x * nx), fract(uv.y * ny));
  var col = panelTone * (0.85 + 0.3 * (fbm(uv.x * 5.0 + seed, uv.y * 5.0, 3.0) * 0.5 + 0.5));
  let d = length(lc - vec2f(0.5, 0.5));
  let cid = cx + cy * nx;
  let face = 1.0 - smoothstep(0.30, 0.315, d);
  let rim = smoothstep(0.29, 0.305, d) * (1.0 - smoothstep(0.36, 0.375, d));
  col = mix(col, faceTone, face);
  col = mix(col, rimTone, rim);
  let ang = atan2(lc.y - 0.5, lc.x - 0.5);
  let ticks = line_near(sin(ang * 10.0), 0.15) * smoothstep(0.20, 0.24, d) * face;
  col = mix(col, faceTone * 0.35 + vec3f(0.05, 0.05, 0.05), ticks);
  let na = rand(vec2f(cid, seed * 0.7)) * 4.2 + 1.2;
  let tip = vec2f(0.5, 0.5) + vec2f(cos(na), sin(na)) * 0.24;
  let ndl = segment_mark(lc, vec2f(0.5, 0.5), tip, 0.02) * face;
  col = mix(col, needleTone, ndl);
  col = mix(col, needleTone * 0.8, dot_mark(lc, vec2f(0.5, 0.5), 0.035) * face);
  let gl = smoothstep(0.20, 0.0, length(lc - vec2f(0.38, 0.36))) * face;
  col = col + vec3f(0.18, 0.18, 0.20) * gl * 0.5;
  col = mix(col, vec3f(0.08, 0.07, 0.06), speckle(px, 2.0, seed, 0.99) * 0.5);
  return sat3(col);
}
