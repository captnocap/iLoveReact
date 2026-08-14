// @material radar_scope
// @slug radar-scope
// @name Radar Scope
// @board neon_surface
// @variant-labels Green Sweep, Amber Airfield, Hostile Contact
// @kind composition
// @tags neon_surface, radar, screen, sweep
// @author fable-scifi_hull
fn radar_scope(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var screen_bg = vec3f(0.01, 0.06, 0.03);
  var linec = vec3f(0.15, 0.65, 0.30);
  var sweepc = vec3f(0.35, 0.95, 0.50);
  var blipc = vec3f(0.85, 1.00, 0.85);
  if (variant > 0.5 && variant < 1.5) {
    screen_bg = vec3f(0.06, 0.04, 0.01);
    linec = vec3f(0.70, 0.50, 0.15);
    sweepc = vec3f(0.95, 0.75, 0.25);
    blipc = vec3f(1.00, 0.95, 0.75);
  } else if (variant >= 1.5) {
    screen_bg = vec3f(0.03, 0.02, 0.04);
    linec = vec3f(0.35, 0.30, 0.55);
    sweepc = vec3f(0.60, 0.45, 0.95);
    blipc = vec3f(1.00, 0.30, 0.25);
  }
  let p = uv - vec2f(0.5, 0.5);
  let r = length(p) * 2.15;
  let ang = atan2(p.y, p.x);
  var col = screen_bg * (0.7 + (fbm(uv.x * 8.0 + seed, uv.y * 8.0, 3.0) * 0.5 + 0.5) * 0.5);
  let ringd = abs(fract(r * 4.0) - 0.0);
  let ring = exp(-pow(fract(r * 4.0) - 0.5, 2.0) * 800.0);
  col = col + linec * ring * 0.5 * (1.0 - smoothstep(0.95, 1.0, r));
  let cross = max(exp(-p.x * p.x * 4000.0), exp(-p.y * p.y * 4000.0));
  col = col + linec * cross * 0.35 * (1.0 - smoothstep(0.95, 1.0, r));
  let sweep_a = fract(seed * 0.173) * 6.2831853;
  let rel = fract((ang - sweep_a) / 6.2831853);
  let wedge = pow(1.0 - rel, 7.0);
  col = col + sweepc * wedge * 0.55 * (1.0 - smoothstep(0.9, 1.0, r));
  for (var i = 0; i < 5; i = i + 1) {
    let fi = f32(i);
    let ba = rand(vec2f(fi * 3.7, seed)) * 6.2831853;
    let br = 0.15 + rand(vec2f(fi * 9.1, seed + 2.0)) * 0.75;
    let bp = vec2f(cos(ba), sin(ba)) * br * 0.465;
    let brel = fract((ba - sweep_a) / 6.2831853);
    let fadeb = pow(1.0 - brel, 2.0);
    let bd = exp(-pow(length(p - bp) * 60.0, 2.0));
    col = col + blipc * bd * (0.25 + fadeb * 0.9);
  }
  let scan = sin(uv.y * 240.0 + seed * 3.0) * 0.5 + 0.5;
  col = col * (0.86 + scan * 0.14);
  let noiseb = speckle(px, 2.0, seed, 0.99);
  col = col + linec * noiseb * 0.3;
  let bezel = smoothstep(0.93, 1.0, r);
  col = mix(col, vec3f(0.09, 0.10, 0.12), bezel);
  return sat3(col);
}
