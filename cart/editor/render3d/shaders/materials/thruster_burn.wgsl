// @material thruster_burn
// @slug thruster-burn
// @name Thruster Burn
// @board neon_surface
// @variant-labels Cold Nozzle, Live Burn, Ancient Soot
// @kind composition
// @tags neon_surface, thruster, scorch, rings
// @author fable-scifi_hull
fn thruster_burn(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let p = uv - vec2f(0.5, 0.5);
  let r = length(p) * 2.0;
  let ang = atan2(p.y, p.x);
  var metal_lo = vec3f(0.14, 0.13, 0.13);
  var metal_hi = vec3f(0.40, 0.38, 0.36);
  var scorch = vec3f(0.06, 0.05, 0.05);
  var ember = vec3f(0.30, 0.18, 0.12);
  var heat = 0.15;
  if (variant > 0.5 && variant < 1.5) {
    metal_lo = vec3f(0.16, 0.12, 0.10);
    metal_hi = vec3f(0.42, 0.34, 0.28);
    scorch = vec3f(0.08, 0.04, 0.03);
    ember = vec3f(1.00, 0.55, 0.15);
    heat = 1.0;
  } else if (variant >= 1.5) {
    metal_lo = vec3f(0.09, 0.09, 0.10);
    metal_hi = vec3f(0.24, 0.23, 0.23);
    scorch = vec3f(0.03, 0.03, 0.03);
    ember = vec3f(0.20, 0.12, 0.09);
    heat = 0.05;
  }
  let ringband = fract(r * 5.0 + seed * 0.11);
  let rid = floor(r * 5.0 + seed * 0.11);
  let rtone = rand(vec2f(rid, seed));
  var col = mix(metal_lo, metal_hi, 0.35 + rtone * 0.4 + sin(ringband * 3.1415926) * 0.25);
  let lip = exp(-pow(ringband - 0.12, 2.0) * 300.0);
  col = col + metal_hi * lip * 0.4;
  let streak = fbm(ang * 2.5 + seed, r * 6.0, 3.0) * 0.5 + 0.5;
  let sootm = smoothstep(0.85, 0.25, r) * (0.4 + streak * 0.6);
  col = mix(col, scorch, sootm);
  let rays = pow(abs(sin(ang * 14.0 + snoise(r * 3.0, seed) * 2.0)), 3.0);
  col = mix(col, scorch * 0.6, rays * smoothstep(0.9, 0.3, r) * 0.5);
  let corebloom = exp(-r * r * 12.0);
  col = mix(col, scorch * 0.5, corebloom * 0.6);
  col = col + ember * corebloom * heat * (0.7 + streak * 0.5);
  col = col + ember * exp(-r * r * 60.0) * heat * 0.8;
  let crack = crack_field(uv, seed, 7.0) * smoothstep(0.7, 0.2, r);
  col = mix(col, ember * heat + scorch * (1.0 - heat), crack * 0.6);
  let fleck = speckle(px, 2.0, seed, 0.98) * smoothstep(0.6, 0.2, r);
  col = col + ember * fleck * heat * 0.8;
  let boltring = exp(-pow(r - 0.93, 2.0) * 900.0) * (0.5 + 0.5 * sin(ang * 16.0));
  col = mix(col, metal_hi * 1.2, sat(boltring) * 0.5);
  return sat3(col);
}
