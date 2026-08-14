// @material pipe_bundle
// @slug pipe-bundle
// @name Pipe Bundle
// @board metal_yard
// @variant-labels Bare Steel, Copper Run, Plant Green
// @kind surface
// @tags metal_yard, pipes, flange, valve
// @author fable-machine_yard
fn pipe_bundle(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var pipeTone = vec3f(0.55, 0.57, 0.60);
  var flangeTone = vec3f(0.40, 0.40, 0.42);
  var wheelTone = vec3f(0.72, 0.16, 0.14);
  var n = 5.0;
  if (variant > 0.5 && variant < 1.5) {
    pipeTone = vec3f(0.71, 0.44, 0.26);
    flangeTone = vec3f(0.35, 0.24, 0.18);
    wheelTone = vec3f(0.20, 0.45, 0.30);
    n = 4.0;
  } else if (variant >= 1.5) {
    pipeTone = vec3f(0.27, 0.42, 0.33);
    flangeTone = vec3f(0.18, 0.26, 0.21);
    wheelTone = vec3f(0.75, 0.62, 0.18);
    n = 6.0;
  }
  let ix = floor(uv.x * n);
  let fx = fract(uv.x * n);
  let jig = rand(vec2f(ix, seed)) * 0.3;
  let shade = sin(fx * 3.14159);
  var col = pipeTone * (0.30 + 0.75 * shade);
  col = col + vec3f(0.25, 0.25, 0.25) * pow(shade, 8.0) * 0.8;
  let gap = 1.0 - smoothstep(0.0, 0.06, fx) * (1.0 - smoothstep(0.94, 1.0, fx));
  col = mix(col, vec3f(0.05, 0.05, 0.06), gap);
  let fy1 = abs(uv.y - (0.25 + jig));
  let flange1 = 1.0 - smoothstep(0.025, 0.045, fy1);
  col = mix(col, flangeTone * (0.5 + 0.6 * shade), flange1 * (1.0 - gap));
  let fy2 = abs(uv.y - (0.72 - jig * 0.5));
  let flange2 = 1.0 - smoothstep(0.02, 0.04, fy2);
  col = mix(col, flangeTone * (0.5 + 0.6 * shade), flange2 * (1.0 - gap));
  let wx = (floor(rand(vec2f(seed, 3.7)) * n) + 0.5) / n;
  let d = length(uv - vec2f(wx, 0.5));
  let ring = 1.0 - smoothstep(0.012, 0.03, abs(d - 0.07));
  col = mix(col, wheelTone, ring);
  col = mix(col, wheelTone * 0.7, dot_mark(uv, vec2f(wx, 0.5), 0.018));
  col = mix(col, vec3f(0.10, 0.09, 0.07), vertical_drips(uv, seed, 0.5) * 0.35);
  col = col + vec3f(0.2, 0.2, 0.2) * speckle(px, 2.0, seed, 0.992) * 0.5;
  return sat3(col);
}
