// @material lily_pond
// @slug lily-pond
// @name Lily Pond
// @board environment
// @variant-labels Monet Morning, Shade Pool, Bloom Festival
// @kind composition
// @tags environment, pond, lily
// @author fable-botanic
fn lily_pond(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var water_lo = vec3f(0.02, 0.09, 0.10);
  var water_hi = vec3f(0.10, 0.24, 0.24);
  var pad_lo = vec3f(0.10, 0.30, 0.13);
  var pad_hi = vec3f(0.24, 0.50, 0.22);
  var bloom_c = vec3f(0.94, 0.62, 0.74);
  var bloom_keep = 0.72;
  if (variant > 0.5 && variant < 1.5) {
    water_lo = vec3f(0.01, 0.05, 0.06);
    water_hi = vec3f(0.05, 0.14, 0.13);
    pad_lo = vec3f(0.06, 0.20, 0.10);
    pad_hi = vec3f(0.14, 0.34, 0.16);
    bloom_c = vec3f(0.90, 0.88, 0.78);
    bloom_keep = 0.88;
  } else if (variant >= 1.5) {
    water_lo = vec3f(0.04, 0.12, 0.14);
    water_hi = vec3f(0.14, 0.30, 0.30);
    bloom_c = vec3f(0.92, 0.42, 0.60);
    bloom_keep = 0.40;
  }
  let ripple = snoise(uv.x * 9.0 + U.time * 0.25 + seed, uv.y * 9.0) * 0.5 + 0.5;
  var col = mix(water_lo, water_hi, ripple);
  let glint = line_near(sin((uv.x + uv.y * 0.3) * 40.0 + U.time * 0.5 + seed), 0.10);
  col = col + vec3f(0.10, 0.13, 0.12) * glint * ripple;
  let g = uv * 4.2 + vec2f(seed * 0.41, seed * 0.19);
  let cell = floor(g);
  let jit = vec2f(rand(cell + vec2f(seed, 5.0)), rand(cell + vec2f(6.0, seed))) * 0.4 + vec2f(0.3);
  let d = g - cell - jit;
  let ang = atan2(d.y, d.x);
  let rr = length(d);
  let present = step(0.30, rand(cell * 2.3 + vec2f(1.0, seed)));
  let notch_dir = rand(cell + vec2f(seed, 9.0)) * 6.28318;
  let notch = smoothstep(0.55, 0.10, abs(sin((ang - notch_dir) * 0.5)) * 3.0) * smoothstep(0.10, 0.30, rr);
  let padmask = smoothstep(0.34, 0.29, rr) * present * (1.0 - notch);
  let padshade = 0.5 + 0.5 * sin(ang * 8.0 + rr * 12.0);
  var padcol = mix(pad_lo, pad_hi, padshade * 0.5 + rand(cell + vec2f(3.0, seed)) * 0.5);
  padcol = mix(padcol, pad_hi * 1.2, smoothstep(0.30, 0.26, rr) * smoothstep(0.24, 0.29, rr));
  col = mix(col, padcol, padmask);
  let bloomcell = step(bloom_keep, rand(cell + vec2f(7.0, seed * 1.3)));
  let bloommask = smoothstep(0.11, 0.05, rr) * present * bloomcell;
  col = mix(col, bloom_c, bloommask);
  col = mix(col, vec3f(0.96, 0.84, 0.30), smoothstep(0.035, 0.015, rr) * present * bloomcell);
  return sat3(col);
}
