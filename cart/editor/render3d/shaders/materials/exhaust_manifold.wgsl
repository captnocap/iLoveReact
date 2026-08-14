// @material exhaust_manifold
// @slug exhaust-manifold
// @name Exhaust Manifold
// @board metal_yard
// @variant-labels Race Tuned, Cast Iron, Blued Titanium
// @kind composition
// @tags metal_yard, exhaust, headers, heat
// @author fable-machine_yard
fn exhaust_manifold(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var steelTone = vec3f(0.58, 0.58, 0.60);
  var goldTone = vec3f(0.78, 0.55, 0.25);
  var blueTone = vec3f(0.30, 0.40, 0.62);
  var tintAmt = 1.0;
  if (variant > 0.5 && variant < 1.5) {
    steelTone = vec3f(0.26, 0.25, 0.24);
    goldTone = vec3f(0.38, 0.28, 0.20);
    blueTone = vec3f(0.22, 0.21, 0.22);
    tintAmt = 0.5;
  } else if (variant >= 1.5) {
    steelTone = vec3f(0.50, 0.52, 0.56);
    goldTone = vec3f(0.70, 0.45, 0.50);
    blueTone = vec3f(0.25, 0.45, 0.70);
    tintAmt = 1.4;
  }
  var col = vec3f(0.09, 0.09, 0.10) * (0.7 + 0.6 * (fbm(uv.x * 5.0 + seed, uv.y * 5.0, 3.0) * 0.5 + 0.5));
  var pipeMask = 0.0;
  var shadeAcc = 0.0;
  for (var i = 0; i < 4; i = i + 1) {
    let fi = f32(i);
    let cx = (fi + 0.5) / 4.0 + sin(uv.y * 4.0 + fi * 1.7 + seed * 0.3) * 0.035;
    let dx = abs(uv.x - cx);
    let w = 0.075;
    let inside = 1.0 - smoothstep(w - 0.012, w, dx);
    let curve = sqrt(max(0.0, 1.0 - (dx / w) * (dx / w)));
    shadeAcc = max(shadeAcc, curve * inside);
    pipeMask = max(pipeMask, inside);
  }
  let heat1 = smoothstep(0.25, 0.55, uv.y);
  let heat2 = smoothstep(0.55, 0.85, uv.y);
  var pipeTone = mix(steelTone, goldTone, heat1 * tintAmt);
  pipeTone = mix(pipeTone, blueTone, heat2 * tintAmt * 0.8);
  pipeTone = pipeTone * (0.30 + 0.85 * shadeAcc);
  pipeTone = pipeTone * (0.9 + 0.2 * (fbm(uv.x * 20.0, uv.y * 20.0 + seed, 2.0) * 0.5 + 0.5));
  col = mix(col, pipeTone, pipeMask);
  let flange = 1.0 - smoothstep(0.0, 0.10, uv.y);
  col = mix(col, vec3f(0.24, 0.24, 0.26) * (0.7 + 0.5 * (fbm(uv.x * 25.0, seed, 2.0) * 0.5 + 0.5)), flange);
  let bx = fract(uv.x * 4.0);
  let bolt = dot_mark(vec2f(bx, uv.y * 10.0), vec2f(0.5, 0.5), 0.14) * flange;
  col = mix(col, vec3f(0.60, 0.60, 0.62), bolt);
  let collectBand = smoothstep(0.90, 0.97, uv.y);
  col = mix(col, vec3f(0.16, 0.15, 0.16), collectBand);
  col = col + vec3f(0.2, 0.2, 0.2) * speckle(px, 2.0, seed, 0.992) * 0.4;
  return sat3(col);
}
