// helpers.wgsl — shared WGSL helpers for the effect_fills material library.
// Hand-owned and stable. Materials reference these; do not fork per-file
// copies. New general-purpose helpers land here (flag additions in review).
// NOTE: fbm/snoise/hsv2rgb/etc are NOT here — framework/gpu/effect_math.wgsl
// is auto-prepended by the host to every Effect/Filter shader and already
// provides them. Redefining them here would be a WGSL duplicate-symbol error.

@group(0) @binding(1) var<storage, read> D: array<f32>;

fn sat(v: f32) -> f32 { return clamp(v, 0.0, 1.0); }

fn sat3(v: vec3f) -> vec3f { return clamp(v, vec3f(0.0, 0.0, 0.0), vec3f(1.0, 1.0, 1.0)); }

fn rand(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453123);
}

fn line_near(v: f32, width: f32) -> f32 {
  let aa = max(fwidth(v), 0.001);
  return 1.0 - smoothstep(width, width + aa, abs(v));
}

fn speckle(px: vec2f, size: f32, seed: f32, threshold: f32) -> f32 {
  let cell = floor(px / size);
  return step(threshold, rand(cell + vec2f(seed * 19.0, seed * 7.0)));
}

fn vertical_drips(uv: vec2f, seed: f32, amount: f32) -> f32 {
  let bands = 8.0 + amount * 6.0;
  let id = floor(uv.x * bands);
  let local = fract(uv.x * bands);
  let lane = rand(vec2f(id, seed));
  let xpos = 0.15 + lane * 0.70;
  let width = 0.025 + rand(vec2f(id + 4.0, seed)) * 0.050;
  let top = rand(vec2f(id + 9.0, seed)) * 0.34;
  let lenv = 0.20 + rand(vec2f(id + 13.0, seed)) * 0.72;
  let stem = 1.0 - smoothstep(width, width + 0.035, abs(local - xpos));
  let ymask = smoothstep(top, top + 0.04, uv.y) * (1.0 - smoothstep(top + lenv, top + lenv + 0.18, uv.y));
  return stem * ymask * step(0.34, lane);
}

fn blotch(uv: vec2f, center: vec2f, radius: f32, squish: vec2f, seed: f32) -> f32 {
  let p = (uv - center) * squish;
  let d = length(p);
  let rag = fbm(uv.x * 16.0 + seed, uv.y * 16.0 - seed, 4.0) * 0.040;
  return 1.0 - smoothstep(radius + rag, radius + rag + 0.08, d);
}

fn crack_field(uv: vec2f, seed: f32, scale: f32) -> f32 {
  let n = snoise(uv.x * scale + seed, uv.y * scale * 1.7 - seed);
  let gate = smoothstep(0.35, 0.82, fbm(uv.x * 3.2 + seed, uv.y * 3.2, 4.0) * 0.5 + 0.5);
  return line_near(n, 0.020) * gate;
}

fn neon_grime(uv: vec2f, px: vec2f, col_in: vec3f, seed: f32, variant: f32) -> vec3f {
  let damp = smoothstep(0.34, 1.0, uv.y);
  let black_mold = smoothstep(0.55, 0.88, fbm(uv.x * 10.0 + seed, uv.y * 8.0 - seed, 4.0) * 0.5 + 0.5) * damp;
  let cyan_leak = vertical_drips(uv + vec2f(0.04, 0.0), seed + 7.0, 1.2 + variant);
  let magenta_bloom = blotch(uv, vec2f(0.72, 0.26), 0.20, vec2f(0.75, 1.5), seed + 13.0);
  var col = mix(col_in, vec3f(0.018, 0.020, 0.019), black_mold * (0.20 + variant * 0.08));
  col = mix(col, vec3f(0.02, 0.76, 0.82), cyan_leak * 0.16);
  col = mix(col, vec3f(0.94, 0.08, 0.48), magenta_bloom * 0.11);
  col = col - vec3f(speckle(px, 2.6, seed, 0.91) * 0.075);
  return sat3(col);
}

fn segment_mark(uv: vec2f, a: vec2f, b: vec2f, width: f32) -> f32 {
  let pa = uv - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0);
  let d = length(pa - ba * h);
  let aa = max(fwidth(d), 0.001);
  return 1.0 - smoothstep(width, width + aa, d);
}

fn dot_mark(uv: vec2f, center: vec2f, radius: f32) -> f32 {
  let d = length(uv - center);
  let aa = max(fwidth(d), 0.001);
  return 1.0 - smoothstep(radius, radius + aa, d);
}

fn rect_mask(p: vec2f, x0: f32, x1: f32, y0: f32, y1: f32, aa: f32) -> f32 {
  let mx = smoothstep(x0 - aa, x0 + aa, p.x) * (1.0 - smoothstep(x1 - aa, x1 + aa, p.x));
  let my = smoothstep(y0 - aa, y0 + aa, p.y) * (1.0 - smoothstep(y1 - aa, y1 + aa, p.y));
  return mx * my;
}

fn brick_wall(uv: vec2f, px: vec2f, lo: vec3f, hi: vec3f, mortar_c: vec3f, seed: f32) -> vec3f {
  let rows = 8.0;
  let cols = 4.0;
  let row = floor(uv.y * rows);
  let off = (row - floor(row * 0.5) * 2.0) * 0.5;
  let buv = vec2f(uv.x * cols + off, uv.y * rows);
  let cell = floor(buv);
  let lcl = fract(buv);
  let nx = min(lcl.x, 1.0 - lcl.x);
  let ny = min(lcl.y, 1.0 - lcl.y);
  let mortar = max(1.0 - smoothstep(0.028, 0.055, nx), 1.0 - smoothstep(0.040, 0.075, ny));
  let tone = rand(cell + vec2f(seed, seed * 2.0));
  let soot = fbm(uv.x * 9.0 + seed, uv.y * 9.0, 4.0) * 0.5 + 0.5;
  var col = mix(lo, hi, tone * 0.6 + soot * 0.4);
  let chip = speckle(px + cell * 9.0, 5.0, seed, 0.94) * smoothstep(0.10, 0.22, nx) * smoothstep(0.10, 0.22, ny);
  col = mix(col, lo * 0.5, chip * 0.30);
  col = mix(col, mortar_c, mortar * 0.85);
  return col;
}

fn paint_window(lc: vec2f, lit: f32, seed: f32) -> vec4f {
  let aa = 0.010;
  // Outer cast-stone surround (lintel above, sill below).
  let sx0 = 0.16; let sx1 = 0.84;
  let sy0 = 0.10; let sy1 = 0.80;
  let surround = rect_mask(lc, sx0, sx1, sy0, sy1, aa);
  // Sash opening, then the glass inset inside the frame.
  let wx0 = 0.24; let wx1 = 0.76;
  let wy0 = 0.18; let wy1 = 0.70;
  let frame = rect_mask(lc, wx0, wx1, wy0, wy1, aa);
  let fin = 0.04;
  let glass = rect_mask(lc, wx0 + fin, wx1 - fin, wy0 + fin, wy1 - fin, aa);

  var stone = vec3f(0.70, 0.68, 0.62);
  stone = stone + vec3f(0.07, 0.07, 0.06) * smoothstep(sy1 - 0.02, sy1, lc.y); // bright sill lip
  stone = stone - vec3f(0.10, 0.10, 0.09) * smoothstep(sy1, sy1 + 0.04, lc.y); // sill shadow below

  let refl = smoothstep(0.0, 1.0, (lc.y - wy0) / (wy1 - wy0));
  var pane = mix(vec3f(0.09, 0.12, 0.17), vec3f(0.20, 0.27, 0.33), refl);
  pane = mix(pane, vec3f(0.97, 0.80, 0.45), lit * (0.50 + 0.50 * (1.0 - refl)));
  pane = pane - vec3f(0.10, 0.10, 0.10) * (1.0 - smoothstep(wy0 + fin, wy0 + fin + 0.05, lc.y)); // top recess shadow

  let sash = vec3f(0.88, 0.86, 0.80);
  let midx = (wx0 + wx1) * 0.5;
  let midy = (wy0 + wy1) * 0.5;
  let mull = max(1.0 - smoothstep(0.006, 0.013, abs(lc.x - midx)), 1.0 - smoothstep(0.006, 0.013, abs(lc.y - midy)));

  var col = stone;
  col = mix(col, sash, frame);
  col = mix(col, pane, glass);
  col = mix(col, sash, mull * glass);
  return vec4f(col, surround);
}

fn leaf_cover(p: vec2f, density: f32, seed: f32) -> f32 {
  let n = fbm(p.x * 14.0 + seed, p.y * 14.0 - seed, 5.0) * 0.5 + 0.5;
  return smoothstep(density, density + 0.12, n);
}

fn leaf_color(p: vec2f, seed: f32) -> vec3f {
  let n = fbm(p.x * 22.0 + seed, p.y * 22.0, 4.0) * 0.5 + 0.5;
  let fleck = rand(floor(p * 40.0) + vec2f(seed, seed));
  return mix(vec3f(0.06, 0.22, 0.07), vec3f(0.30, 0.56, 0.16), n * 0.7 + fleck * 0.3);
}

fn wallpaper_base(uv: vec2f, px: vec2f, seed: f32, bg: vec3f, ink: vec3f, accent: vec3f, pattern: f32) -> vec3f {
  var col = bg + vec3f((fbm(uv.x * 18.0 + seed, uv.y * 18.0, 4.0) - 0.5) * 0.05);
  let repeat = uv * vec2f(5.0, 7.0);
  let l = fract(repeat) - vec2f(0.5, 0.5);
  let floral = 1.0 - smoothstep(0.12, 0.18, length(l * vec2f(1.0, 1.3)));
  let stripe = 1.0 - smoothstep(0.08, 0.13, abs(fract(uv.x * 9.0) - 0.5));
  let damask = line_near(sin(uv.x * 34.0 + sin(uv.y * 18.0) * 2.0), 0.12) * line_near(sin(uv.y * 24.0), 0.18);
  let stars = line_near(abs(l.x) + abs(l.y) - 0.18, 0.035);
  let pat = select(select(floral, stripe, pattern > 0.5), damask, pattern > 1.5);
  let pat2 = select(pat, stars, pattern > 2.5);
  col = mix(col, ink, pat2 * 0.65);
  col = mix(col, accent, speckle(px, 10.0, seed, 0.965) * 0.40);
  return sat3(col);
}

fn quality_pass(col_in: vec3f, uv: vec2f, px: vec2f, seed: f32, quality: f32, board: f32) -> vec3f {
  let raw_q = clamp(quality, 0.0, 4.0);
  let q = clamp(raw_q - 2.0, 0.0, 2.0);
  let retro = clamp(2.0 - raw_q, 0.0, 2.0);
  let q01 = q * 0.5;
  let fine = fbm(uv.x * (22.0 + q * 24.0) + seed, uv.y * (22.0 + q * 24.0) - seed, 5.0) * 0.5 + 0.5;
  let coarse = fbm(uv.x * (6.0 + q * 4.0) + seed * 0.3, uv.y * (6.0 + q * 4.0) - seed * 0.2, 4.0) * 0.5 + 0.5;
  let fleck = speckle(px, max(1.4, 4.8 - q * 1.3), seed + 44.0, 0.975 - q * 0.035);
  let scratch = line_near(snoise(uv.x * (7.0 + q * 5.0) + seed, uv.y * (15.0 + q * 6.0) - seed), 0.018 + q * 0.005);
  let luma = dot(col_in, vec3f(0.299, 0.587, 0.114));
  var out_col = mix(vec3f(luma, luma, luma), col_in, 0.84 + q01 * 0.16);
  out_col = out_col + vec3f((fine - 0.5) * (0.025 + q * 0.035));
  out_col = out_col - vec3f(fleck * (0.020 + q * 0.035));
  out_col = mix(out_col, out_col * vec3f(0.66, 0.64, 0.58), scratch * smoothstep(0.58 - q * 0.06, 0.92, coarse) * (0.16 + q * 0.10));
  if (board > 0.5 && board < 1.5) {
    out_col = mix(out_col, vec3f(0.020, 0.024, 0.018), smoothstep(0.60 - q * 0.05, 0.94, coarse) * (0.14 + q * 0.12));
    out_col = mix(out_col, vec3f(0.72, 0.70, 0.58), fleck * (0.10 + q * 0.08));
  }
  if (board > 2.5 && board < 3.5) {
    let neon_haze = smoothstep(0.52 - q * 0.04, 0.88, coarse);
    out_col = mix(out_col, out_col + vec3f(0.08, 0.035, 0.11), neon_haze * (0.18 + q * 0.05));
    out_col = mix(out_col, vec3f(0.015, 0.018, 0.020), fleck * (0.10 + q * 0.08));
  }
  if (board > 3.5 && board < 4.5) {
    // Board E neon surface — keep it glossy: bloom the bright neon, very little
    // grime. The dream pole should read clean and lit, not condemned.
    let bloom = smoothstep(0.55, 0.95, dot(out_col, vec3f(0.299, 0.587, 0.114)));
    out_col = out_col + out_col * bloom * (0.12 + q * 0.06);
    out_col = out_col - vec3f(fleck * (0.010 + q * 0.010));
  }
  if (board > 4.5 && board < 5.5) {
    // Board F contraband — Spun squalor grade: shadow-mold in the lows, lint in
    // the speckle. Mirrors Board B's condemned grime.
    out_col = mix(out_col, vec3f(0.020, 0.022, 0.018), smoothstep(0.60 - q * 0.05, 0.94, coarse) * (0.12 + q * 0.10));
    out_col = mix(out_col, vec3f(0.10, 0.09, 0.07), fleck * (0.08 + q * 0.06));
  }
  if (board > 5.5 && board < 6.5) {
    // Board G liminal — threshold surfaces: preserve translucency, add a faint
    // frost/ash bloom in the highs, keep the mid-tones clean so state-changes read.
    let threshold_bloom = smoothstep(0.55 - q * 0.04, 0.92, luma);
    out_col = out_col + out_col * threshold_bloom * (0.10 + q * 0.05);
    out_col = mix(out_col, vec3f(0.015, 0.018, 0.020), fleck * (0.06 + q * 0.04));
  }
  if (board > 6.5 && board < 7.5) {
    // Board H second pass — environment alts: aggregate fleck, subtle weathering
    // in the lows, but keep the crisp SDF reads intact.
    out_col = mix(out_col, vec3f(0.022, 0.024, 0.020), smoothstep(0.55 - q * 0.04, 0.88, coarse) * (0.08 + q * 0.06));
    out_col = out_col + vec3f((fine - 0.5) * (0.012 + q * 0.018));
  }
  if (board > 7.5 && board < 8.5) {
    // Board I facades — keep the brick crisp and the painted windows clean; only
    // a whisper of soot in the lows so the masonry doesn't read as plastic.
    out_col = mix(out_col, vec3f(0.030, 0.028, 0.024), smoothstep(0.62 - q * 0.04, 0.94, coarse) * (0.06 + q * 0.05));
  }
  if (board > 8.5 && board < 9.5) {
    // Board J wall props — same crisp brick treatment; the neon/lit props supply
    // their own glow, so add only the faintest soot and leave the highs alone.
    out_col = mix(out_col, vec3f(0.030, 0.028, 0.024), smoothstep(0.64 - q * 0.04, 0.94, coarse) * (0.05 + q * 0.04));
  }
  if (board > 9.5 && board < 12.5) {
    // Boards K-M construction materials — add physical grit and scratches, but
    // keep tile seams and metal/stone reads strong.
    out_col = mix(out_col, vec3f(0.030, 0.030, 0.026), smoothstep(0.58 - q * 0.04, 0.92, coarse) * (0.05 + q * 0.05));
    out_col = out_col - vec3f(fleck * (0.010 + q * 0.018));
  }
  if (board > 12.5 && board < 13.5) {
    // Board N wallpaper — let print patterns survive; add fiber and age instead
    // of generic soot.
    out_col = out_col + vec3f((fine - 0.5) * (0.018 + q * 0.018));
    out_col = mix(out_col, vec3f(0.40, 0.32, 0.22), fleck * (0.05 + q * 0.03));
  }
  if (board > 13.5) {
    // Board O gradients — soft authored fields; preserve color, add only haze.
    let glow = smoothstep(0.48, 0.95, luma);
    out_col = out_col + out_col * glow * (0.05 + q * 0.04);
  }
  if (retro > 0.001) {
    let dither_cell = floor(px / (1.0 + retro));
    let dither = rand(dither_cell + vec2f(seed, seed * 2.0)) - 0.5;
    let levels = mix(12.0, 6.0, retro * 0.5);
    out_col = floor(out_col * levels + dither * (0.45 + retro * 0.25)) / levels;
    let retro_luma = dot(out_col, vec3f(0.299, 0.587, 0.114));
    out_col = mix(vec3f(retro_luma, retro_luma, retro_luma), out_col, 0.72 + (2.0 - retro) * 0.10);
    out_col = out_col * (0.92 + line_near(sin((uv.x + uv.y) * (58.0 - retro * 15.0)), 0.035) * 0.06);
  }
  return sat3(out_col);
}
