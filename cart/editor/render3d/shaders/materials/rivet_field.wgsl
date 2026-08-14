// @material rivet_field
// @slug rivet-field
// @name Rivet Field
// @board metal_yard
// @variant-labels Mill Gray, Warship Navy, Rust Belt
// @kind surface
// @tags metal_yard, rivets, plate, seams
// @author fable-machine_yard
fn rivet_field(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var plateLo = vec3f(0.42, 0.44, 0.47);
  var plateHi = vec3f(0.56, 0.58, 0.61);
  var rivTone = vec3f(0.35, 0.36, 0.38);
  var rustAmt = 0.15;
  if (variant > 0.5 && variant < 1.5) {
    plateLo = vec3f(0.14, 0.19, 0.28);
    plateHi = vec3f(0.24, 0.30, 0.40);
    rivTone = vec3f(0.12, 0.15, 0.21);
    rustAmt = 0.30;
  } else if (variant >= 1.5) {
    plateLo = vec3f(0.38, 0.24, 0.15);
    plateHi = vec3f(0.52, 0.33, 0.19);
    rivTone = vec3f(0.28, 0.16, 0.10);
    rustAmt = 0.85;
  }
  let rows = 4.0;
  let ry = floor(uv.y * rows);
  let off = rand(vec2f(ry, seed)) * 0.5;
  let fx = fract(uv.x * 2.0 + off);
  let fy = fract(uv.y * rows);
  var col = mix(plateLo, plateHi, fbm(uv.x * 12.0 + seed, uv.y * 12.0, 3.0) * 0.5 + 0.5);
  let seamH = 1.0 - smoothstep(0.02, 0.05, min(fy, 1.0 - fy));
  let seamV = 1.0 - smoothstep(0.008, 0.022, min(fx, 1.0 - fx));
  col = mix(col, plateLo * 0.5, max(seamH, seamV) * 0.8);
  let rcx = (floor(uv.x * 16.0) + 0.5) / 16.0;
  let rcy1 = (ry + 0.10) / rows;
  let rcy2 = (ry + 0.90) / rows;
  let d1 = length(uv - vec2f(rcx, rcy1));
  let d2 = length(uv - vec2f(rcx, rcy2));
  let dr = min(d1, d2);
  let riv = 1.0 - smoothstep(0.011, 0.017, dr);
  col = mix(col, rivTone, riv);
  let rivHi = 1.0 - smoothstep(0.004, 0.008, length(uv - vec2f(rcx - 0.004, min(rcy1, rcy2) - 0.004)));
  col = col + vec3f(0.25, 0.25, 0.25) * min(rivHi, riv) * 0.8;
  col = mix(col, vec3f(0.40, 0.22, 0.11), vertical_drips(uv, seed + 7.0, 0.5) * rustAmt);
  col = mix(col, vec3f(0.33, 0.18, 0.10), blotch(uv, vec2f(0.5, 0.5), 0.4, vec2f(1.2, 1.0), seed + 2.0) * rustAmt * 0.5);
  col = col + vec3f(0.2, 0.2, 0.2) * speckle(px, 2.0, seed, 0.99) * 0.4;
  return sat3(col);
}
