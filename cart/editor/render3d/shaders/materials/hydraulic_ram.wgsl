// @material hydraulic_ram
// @slug hydraulic-ram
// @name Hydraulic Ram
// @board metal_yard
// @variant-labels Chrome Extended, Oil Weeper, Safety Yellow
// @kind composition
// @tags metal_yard, hydraulic, chrome, piston
// @author fable-machine_yard
fn hydraulic_ram(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var houseTone = vec3f(0.22, 0.24, 0.27);
  var rodHi = vec3f(0.88, 0.91, 0.95);
  var rodLo = vec3f(0.22, 0.26, 0.31);
  var glandY = 0.34;
  var oilAmt = 0.25;
  if (variant > 0.5 && variant < 1.5) {
    houseTone = vec3f(0.16, 0.15, 0.13);
    rodHi = vec3f(0.78, 0.80, 0.82);
    oilAmt = 0.95;
    glandY = 0.48;
  } else if (variant >= 1.5) {
    houseTone = vec3f(0.80, 0.62, 0.12);
    rodHi = vec3f(0.90, 0.92, 0.96);
    oilAmt = 0.4;
    glandY = 0.40;
  }
  let wallTone = vec3f(0.14, 0.14, 0.15);
  var col = wallTone * (0.7 + 0.5 * (fbm(uv.x * 6.0 + seed, uv.y * 6.0, 3.0) * 0.5 + 0.5));
  let xr = (uv.x - 0.5) / 0.11;
  let rodCore = 1.0 - smoothstep(0.9, 1.0, abs(xr));
  let curve = sqrt(max(0.0, 1.0 - xr * xr));
  var rodTone = mix(rodLo, rodHi, curve);
  rodTone = rodTone + vec3f(0.20, 0.20, 0.22) * (1.0 - smoothstep(0.02, 0.12, abs(xr + 0.35)));
  rodTone = rodTone * (0.92 + 0.16 * (fbm(uv.y * 30.0 + seed, uv.x * 4.0, 2.0) * 0.5 + 0.5));
  let rodZone = smoothstep(glandY, glandY + 0.01, uv.y) * (1.0 - smoothstep(0.94, 0.96, uv.y));
  col = mix(col, rodTone, rodCore * rodZone);
  let xh = (uv.x - 0.5) / 0.19;
  let houseCore = 1.0 - smoothstep(0.92, 1.0, abs(xh));
  let hcurve = sqrt(max(0.0, 1.0 - xh * xh));
  var houseCol = houseTone * (0.35 + 0.75 * hcurve);
  houseCol = houseCol * (0.9 + 0.2 * (fbm(uv.y * 20.0, uv.x * 8.0 + seed, 2.0) * 0.5 + 0.5));
  let houseZone = 1.0 - smoothstep(glandY, glandY + 0.012, uv.y);
  col = mix(col, houseCol, houseCore * houseZone);
  let gland = 1.0 - smoothstep(0.02, 0.035, abs(uv.y - glandY));
  col = mix(col, vec3f(0.40, 0.42, 0.45) * (0.4 + 0.8 * hcurve), gland * houseCore);
  let capBand = 1.0 - smoothstep(0.02, 0.04, abs(uv.y - 0.95));
  col = mix(col, vec3f(0.32, 0.34, 0.37) * (0.4 + 0.8 * curve), capBand * rodCore);
  let boltL = dot_mark(uv, vec2f(0.36, glandY), 0.014);
  let boltR = dot_mark(uv, vec2f(0.64, glandY), 0.014);
  col = mix(col, vec3f(0.55, 0.56, 0.58), max(boltL, boltR));
  let weep = vertical_drips(vec2f(uv.x, uv.y - glandY), seed + 5.0, 0.6) * (1.0 - smoothstep(glandY, glandY + 0.4, uv.y) * 0.0);
  col = mix(col, vec3f(0.09, 0.08, 0.05), weep * oilAmt * houseZone * houseCore);
  col = mix(col, vec3f(0.09, 0.08, 0.05), blotch(uv, vec2f(0.5, 0.15), 0.2, vec2f(1.0, 1.6), seed + 2.0) * oilAmt * 0.6);
  col = col + vec3f(0.2, 0.2, 0.2) * speckle(px, 2.0, seed, 0.992) * 0.4;
  return sat3(col);
}
