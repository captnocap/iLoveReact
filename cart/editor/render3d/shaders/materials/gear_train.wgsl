// @material gear_train
// @slug gear-train
// @name Gear Train
// @board metal_yard
// @variant-labels Grease Pit, Clock Brass, Seized Rust
// @kind composition
// @tags metal_yard, gears, grease, teeth
// @author fable-machine_yard
fn gear_train(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var gearTone = vec3f(0.44, 0.45, 0.47);
  var bgTone = vec3f(0.08, 0.07, 0.06);
  var greaseTone = vec3f(0.10, 0.09, 0.05);
  var greaseAmt = 0.8;
  if (variant > 0.5 && variant < 1.5) {
    gearTone = vec3f(0.68, 0.55, 0.28);
    bgTone = vec3f(0.20, 0.16, 0.11);
    greaseAmt = 0.2;
  } else if (variant >= 1.5) {
    gearTone = vec3f(0.46, 0.28, 0.16);
    bgTone = vec3f(0.12, 0.09, 0.07);
    greaseTone = vec3f(0.30, 0.17, 0.09);
    greaseAmt = 0.6;
  }
  var col = bgTone * (0.7 + 0.6 * (fbm(uv.x * 6.0 + seed, uv.y * 6.0, 3.0) * 0.5 + 0.5));
  let spin = seed * 0.37;
  let p1 = uv - vec2f(0.33, 0.42);
  let r1 = length(p1);
  let a1 = atan2(p1.y, p1.x) + spin;
  let rr1 = 0.24 + 0.025 * smoothstep(-0.4, 0.4, sin(a1 * 14.0));
  let g1 = 1.0 - smoothstep(rr1, rr1 + 0.012, r1);
  let hole1 = 1.0 - smoothstep(0.05, 0.062, r1);
  let spoke1 = smoothstep(0.35, 0.6, abs(sin(a1 * 2.5))) * smoothstep(0.09, 0.11, r1) * (1.0 - smoothstep(0.17, 0.19, r1));
  var tone1 = gearTone * (0.55 + 0.5 * (fbm(a1 * 3.0, r1 * 20.0 + seed, 2.0) * 0.5 + 0.5));
  tone1 = mix(tone1, tone1 * 0.35, spoke1);
  tone1 = mix(tone1, bgTone * 0.7, hole1);
  col = mix(col, tone1, g1);
  let p2 = uv - vec2f(0.72, 0.63);
  let r2 = length(p2);
  let a2 = atan2(p2.y, p2.x) - spin * 1.4;
  let rr2 = 0.165 + 0.022 * smoothstep(-0.4, 0.4, sin(a2 * 10.0));
  let g2 = 1.0 - smoothstep(rr2, rr2 + 0.012, r2);
  let hole2 = 1.0 - smoothstep(0.035, 0.047, r2);
  var tone2 = gearTone * (0.45 + 0.55 * (fbm(a2 * 3.0 + 5.0, r2 * 20.0 + seed, 2.0) * 0.5 + 0.5));
  tone2 = mix(tone2, bgTone * 0.7, hole2);
  col = mix(col, tone2, g2);
  let sheen = smoothstep(0.3, 0.0, length(uv - vec2f(0.33, 0.30)));
  col = col + vec3f(0.18, 0.18, 0.16) * sheen * max(g1, g2) * 0.6;
  let smear = blotch(uv, vec2f(0.52, 0.52), 0.30, vec2f(1.3, 0.9), seed + 8.0);
  col = mix(col, greaseTone, smear * greaseAmt * 0.7);
  col = col + vec3f(0.2, 0.2, 0.18) * speckle(px, 2.0, seed, 0.99) * 0.4;
  return sat3(col);
}
