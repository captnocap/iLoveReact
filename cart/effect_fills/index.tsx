import { useState } from 'react';
import { Box, Col, Effect, Pressable, Row, ScrollView, Text } from '@reactjit/runtime/primitives';

const SWATCH = 125;
const VARIANTS = [0, 1, 2] as const;

const MATERIALS = [
  { id: 0, name: 'Road' },
  { id: 1, name: 'Concrete' },
  { id: 2, name: 'Brick' },
  { id: 3, name: 'Sand' },
  { id: 4, name: 'Water' },
  { id: 5, name: 'Grass' },
  { id: 6, name: 'Wood' },
] as const;

const GRUNGE_MATERIALS = [
  { id: 0, name: 'Mold Wall' },
  { id: 1, name: 'Peel Paint' },
  { id: 2, name: 'Linoleum' },
  { id: 3, name: 'Bath Tile' },
  { id: 4, name: 'Mildew Brick' },
  { id: 5, name: 'Rot Siding' },
  { id: 6, name: 'Rust Sheet' },
] as const;

const PROP_MATERIALS = [
  { id: 0, name: 'Blade Steel' },
  { id: 1, name: 'Gunmetal' },
  { id: 2, name: 'Grip Polymer' },
  { id: 3, name: 'Leather' },
  { id: 4, name: 'Denim' },
  { id: 5, name: 'Fabric' },
  { id: 6, name: 'Skin' },
] as const;

const VICE_MATERIALS = [
  { id: 0, name: 'Peel Wallpaper' },
  { id: 1, name: 'Motel Carpet' },
  { id: 2, name: 'Rotten Rug' },
  { id: 3, name: 'Neon Stucco' },
  { id: 4, name: 'Pool Tile' },
  { id: 5, name: 'Booth Vinyl' },
  { id: 6, name: 'Drop Ceiling' },
  { id: 7, name: 'PDX Carpet' },
] as const;

// Board E / Neon Surface — Claude's dream-pole materials (board id 4).
const SURFACE_MATERIALS = [
  { id: 0, name: 'Stucco Facade' },
  { id: 1, name: 'Neon Tube' },
  { id: 2, name: 'Sunset Sky' },
  { id: 3, name: 'Wet Asphalt' },
  { id: 4, name: 'Car Paint' },
  { id: 5, name: 'CRT Screen' },
  { id: 6, name: 'Palm Canopy' },
] as const;

// Board F / Contraband & Consequence — Claude's squalor-pole game-objects (board id 5).
const CONTRA_MATERIALS = [
  { id: 0, name: 'Cash Stack' },
  { id: 1, name: 'Product Baggie' },
  { id: 2, name: 'Blood Pool' },
  { id: 3, name: 'Evidence' },
  { id: 4, name: 'Refuse' },
  { id: 5, name: 'Corkboard' },
  { id: 6, name: 'Substance' },
] as const;

const QUALITY_GRADES = [
  { id: 0, label: 'PSX', note: '32px snap, 6-bit color' },
  { id: 1, label: 'PS2', note: '64px snap, banded color' },
  { id: 2, label: 'Preview', note: 'coarse pass' },
  { id: 3, label: 'Std', note: 'game-ready' },
  { id: 4, label: 'Max', note: 'extra detail' },
] as const;
type QualityGrade = typeof QUALITY_GRADES[number]['id'];
type BoardId = 0 | 1 | 2 | 3 | 4 | 5;

const FILL_SHADER = `
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

fn road(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let coarse = fbm(uv.x * 18.0 + seed, uv.y * 18.0 - seed, 5.0) * 0.5 + 0.5;
  let tar = fbm(uv.x * 5.0 - seed * 0.4, uv.y * 11.0 + seed * 0.3, 4.0) * 0.5 + 0.5;
  var col = mix(vec3f(0.030, 0.033, 0.034), vec3f(0.125, 0.128, 0.122), coarse);
  col = mix(col, vec3f(0.012, 0.014, 0.015), smoothstep(0.72, 0.98, tar) * 0.38);
  col = col + vec3f(0.13, 0.13, 0.12) * speckle(px, 2.4, seed, 0.948);
  col = col - vec3f(0.045, 0.043, 0.040) * speckle(px + vec2f(19.0, 7.0), 3.5, seed, 0.955);
  col = col - vec3f(0.055, 0.054, 0.052) * crack_field(uv, seed, 8.0);
  if (variant < 0.5) {
    let dash = step(0.38, fract(uv.y * 5.0 + 0.08));
    let stripe = line_near(uv.x - 0.50 + snoise(uv.y * 2.0, seed) * 0.010, 0.022) * dash;
    col = mix(col, vec3f(0.96, 0.74, 0.26), stripe * 0.90);
  } else if (variant < 1.5) {
    let side = line_near(uv.x - 0.18, 0.012) + line_near(uv.x - 0.82, 0.012);
    col = mix(col, vec3f(0.78, 0.80, 0.75), sat(side) * 0.62);
  } else {
    let tar_patch = smoothstep(0.54, 0.63, fbm(uv.x * 6.0 + 8.0, uv.y * 6.0 + seed, 4.0) * 0.5 + 0.5);
    col = mix(col, vec3f(0.018, 0.020, 0.021), tar_patch * 0.36);
  }
  return sat3(col);
}

fn concrete(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let cloud = fbm(uv.x * 7.0 + seed * 0.7, uv.y * 7.0 - seed, 5.0) * 0.5 + 0.5;
  let trowel = sin((uv.x * 0.9 + uv.y * 1.6 + fbm(uv.x * 2.5, uv.y * 2.5 + seed, 3.0) * 0.18) * 24.0) * 0.5 + 0.5;
  var col = mix(vec3f(0.40, 0.405, 0.390), vec3f(0.72, 0.72, 0.68), cloud) + vec3f(trowel * 0.035);
  if (variant < 0.5) {
    col = col + vec3f(line_near(sin((uv.x + fbm(uv.x * 2.0, uv.y * 4.0, 3.0) * 0.03) * 95.0), 0.16) * 0.035);
  } else if (variant < 1.5) {
    col = col - vec3f(sat(line_near(uv.x - 0.50, 0.010) + line_near(uv.y - 0.50, 0.010)) * 0.12);
  } else {
    col = col - vec3f(crack_field(uv, seed, 7.5) * 0.18);
  }
  col = col - vec3f(speckle(px, 4.5, seed, 0.91) * 0.075) + vec3f(speckle(px + vec2f(11.0, 23.0), 6.5, seed, 0.965) * 0.065);
  return sat3(col);
}

fn brick(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let rows = 6.0 + variant;
  let cols = 3.2 + variant * 0.55;
  let row = floor(uv.y * rows);
  let offset = (row - floor(row * 0.5) * 2.0) * 0.5;
  let buv = vec2f(uv.x * cols + offset, uv.y * rows);
  let cell = floor(buv);
  let local = fract(buv);
  let near_x = min(local.x, 1.0 - local.x);
  let near_y = min(local.y, 1.0 - local.y);
  let mortar = max(1.0 - smoothstep(0.030, 0.055, near_x), 1.0 - smoothstep(0.035, 0.065, near_y));
  let tone = rand(cell + vec2f(seed, seed * 2.0));
  let soot = fbm(uv.x * 10.0 + seed, uv.y * 10.0, 4.0) * 0.5 + 0.5;
  var a = vec3f(0.45, 0.13, 0.075);
  var b = vec3f(0.82, 0.31, 0.16);
  if (variant > 0.5 && variant < 1.5) {
    a = vec3f(0.30, 0.105, 0.085);
    b = vec3f(0.62, 0.20, 0.13);
  } else if (variant >= 1.5) {
    a = vec3f(0.58, 0.42, 0.31);
    b = vec3f(0.84, 0.62, 0.45);
  }
  var col = mix(a, b, tone * 0.65 + soot * 0.35);
  let chip = speckle(px + cell * 9.0, 5.0, seed, 0.935) * smoothstep(0.10, 0.22, near_x) * smoothstep(0.10, 0.22, near_y);
  col = mix(col, vec3f(0.18, 0.12, 0.10), chip * 0.34);
  col = mix(col, vec3f(0.55, 0.53, 0.48), mortar * (0.88 - variant * 0.08));
  return sat3(col);
}

fn sand(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let dune_warp = fbm(uv.x * 3.0 + seed, uv.y * 2.0 - seed, 4.0);
  let ripple = line_near(sin(uv.y * (34.0 + variant * 5.0) + uv.x * (9.0 - variant * 2.0) + dune_warp * 4.0), 0.055 + variant * 0.012);
  let noise = fbm(uv.x * 20.0, uv.y * 20.0 + seed, 4.0) * 0.5 + 0.5;
  var col = mix(vec3f(0.66, 0.50, 0.30), vec3f(0.90, 0.76, 0.48), noise);
  if (variant > 0.5 && variant < 1.5) {
    col = mix(col, vec3f(0.43, 0.34, 0.24), smoothstep(0.20, 0.88, uv.y) * 0.48);
  } else if (variant >= 1.5) {
    col = mix(col, vec3f(0.80, 0.57, 0.30), 0.36);
  }
  col = col + vec3f(0.12, 0.10, 0.06) * ripple;
  col = col + vec3f(0.09, 0.075, 0.045) * speckle(px, 1.8, seed, 0.72) - vec3f(0.10, 0.075, 0.045) * speckle(px + vec2f(5.0, 13.0), 2.6, seed, 0.82);
  return sat3(col);
}

fn water(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let t = U.time;
  let warp = fbm(uv.x * 4.0 + t * 0.08 + seed, uv.y * 4.0 - t * 0.06, 4.0);
  let wave_a = sin((uv.x * 38.0 + uv.y * 11.0) + warp * 5.0 + t * (1.1 + variant * 0.2));
  let wave_b = sin((uv.x * -18.0 + uv.y * 42.0) + snoise(uv.x * 8.0, uv.y * 8.0 + seed) * 3.0 - t * 1.4);
  let caustic = smoothstep(0.72, 0.98, wave_a * 0.5 + wave_b * 0.5);
  var deep = vec3f(0.025, 0.13, 0.22);
  var shallow = vec3f(0.08, 0.55, 0.70);
  if (variant > 0.5 && variant < 1.5) {
    deep = vec3f(0.010, 0.050, 0.13);
    shallow = vec3f(0.07, 0.27, 0.60);
  } else if (variant >= 1.5) {
    deep = vec3f(0.035, 0.18, 0.17);
    shallow = vec3f(0.19, 0.72, 0.62);
  }
  var col = mix(deep, shallow, sat(uv.y * 0.55 + warp * 0.25 + 0.45)) + vec3f(0.22, 0.36, 0.40) * caustic;
  let foam = line_near(sin(uv.y * 22.0 + uv.x * 8.0 + t * 0.8), 0.035) * smoothstep(0.78, 1.0, variant);
  return sat3(mix(col, vec3f(0.82, 0.95, 0.91), foam * 0.36));
}

fn grass(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let wind = snoise(uv.x * 2.0 + U.time * 0.30 + seed, uv.y * 4.0 - U.time * 0.30);
  let blade = line_near(sin((uv.x + wind * 0.035) * (88.0 + variant * 18.0) + uv.y * 8.0), 0.18);
  let clump = fbm(uv.x * 8.0 + seed, uv.y * 8.0, 5.0) * 0.5 + 0.5;
  var low = vec3f(0.035, 0.18, 0.070);
  var high = vec3f(0.24, 0.58, 0.16);
  if (variant > 0.5 && variant < 1.5) {
    low = vec3f(0.020, 0.12, 0.065);
    high = vec3f(0.18, 0.46, 0.25);
  } else if (variant >= 1.5) {
    low = vec3f(0.22, 0.19, 0.075);
    high = vec3f(0.62, 0.52, 0.20);
  }
  var col = mix(low, high, clump) + vec3f(0.10, 0.18, 0.06) * blade;
  let seed_head = speckle(px, 8.0, seed, 0.965) * smoothstep(0.15, 0.95, uv.y);
  return sat3(mix(col, vec3f(0.80, 0.72, 0.42), seed_head * (0.28 + variant * 0.10)));
}

fn wood(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var low = vec3f(0.38, 0.18, 0.070);
  var high = vec3f(0.80, 0.47, 0.20);
  if (variant > 0.5 && variant < 1.5) {
    low = vec3f(0.18, 0.095, 0.055);
    high = vec3f(0.52, 0.30, 0.15);
  } else if (variant >= 1.5) {
    low = vec3f(0.52, 0.34, 0.16);
    high = vec3f(0.92, 0.72, 0.40);
  }
  var grain = 0.0;
  if (variant < 1.5) {
    let warp = fbm(uv.x * 4.0 + seed, uv.y * 10.0 - seed, 5.0);
    let x = uv.x + warp * 0.075 + sin(uv.y * 9.0 + seed) * 0.015;
    grain = sin(x * (54.0 + variant * 22.0) + fbm(uv.x * 13.0, uv.y * 4.0 + seed, 3.0) * 7.0) * 0.5 + 0.5;
  } else {
    let p = uv - vec2f(0.50, 0.50);
    grain = sin(length(p * vec2f(1.0, 1.12)) * 92.0 + fbm(uv.x * 12.0, uv.y * 12.0 + seed, 4.0) * 7.0) * 0.5 + 0.5;
  }
  var col = mix(low, high, grain * 0.72 + 0.16);
  col = col - vec3f(0.10, 0.07, 0.035) * speckle(px, 3.0, seed, 0.945);
  col = col + vec3f(line_near(sin(uv.x * 220.0 + seed), 0.10) * 0.025);
  return sat3(col);
}

fn mold_wall(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let paper = fbm(uv.x * 9.0 + seed, uv.y * 9.0 - seed, 5.0) * 0.5 + 0.5;
  var col = mix(vec3f(0.35, 0.32, 0.25), vec3f(0.70, 0.65, 0.52), paper);
  col = mix(col, vec3f(0.54, 0.42, 0.27), 0.22 + variant * 0.10);
  let mold = sat(blotch(uv, vec2f(0.24, 0.68), 0.18 + variant * 0.03, vec2f(1.2, 0.8), seed) + blotch(uv, vec2f(0.74, 0.33), 0.15, vec2f(0.8, 1.4), seed + 4.0));
  col = mix(col, vec3f(0.045, 0.090, 0.045), mold * 0.74);
  col = mix(col, vec3f(0.23, 0.19, 0.13), line_near(length((uv - vec2f(0.30, 0.30)) * vec2f(1.0, 1.25)) - 0.23, 0.022) * (0.35 + variant * 0.15));
  col = col - vec3f(vertical_drips(uv, seed, variant) * 0.22 + crack_field(uv, seed, 6.0) * 0.18 + speckle(px, 2.0, seed, 0.92) * 0.10);
  return sat3(col);
}

fn peel_paint(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var top_col = vec3f(0.62, 0.67, 0.55);
  var under_col = vec3f(0.36, 0.25, 0.18);
  if (variant > 0.5 && variant < 1.5) {
    top_col = vec3f(0.30, 0.48, 0.43);
    under_col = vec3f(0.67, 0.55, 0.38);
  } else if (variant >= 1.5) {
    top_col = vec3f(0.68, 0.58, 0.42);
    under_col = vec3f(0.18, 0.16, 0.14);
  }
  let grain = fbm(uv.x * 12.0 + seed, uv.y * 12.0, 5.0) * 0.5 + 0.5;
  let peel = smoothstep(0.44, 0.59, fbm(uv.x * 5.0 + seed, uv.y * 5.0 - seed, 5.0) * 0.5 + 0.5);
  var col = mix(top_col, under_col, peel);
  col = col + vec3f(0.10, 0.09, 0.07) * line_near(fbm(uv.x * 7.0 + seed, uv.y * 7.0, 4.0), 0.035) * peel;
  col = col - vec3f(0.11, 0.09, 0.07) * vertical_drips(uv, seed + 2.0, 1.0);
  col = mix(col, vec3f(0.035, 0.070, 0.035), blotch(uv, vec2f(0.76, 0.72), 0.17, vec2f(1.0, 0.9), seed) * 0.46);
  col = col + vec3f((grain - 0.5) * 0.08) - vec3f(speckle(px, 3.0, seed, 0.90) * 0.08);
  return sat3(col);
}

fn linoleum(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let grid = uv * (vec2f(3.0, 3.0) + vec2f(variant * 0.8, variant * 0.4));
  let cell = floor(grid);
  let local = fract(grid);
  let seam_mark = max(1.0 - smoothstep(0.025, 0.055, min(local.x, 1.0 - local.x)), 1.0 - smoothstep(0.025, 0.055, min(local.y, 1.0 - local.y)));
  let tone = rand(cell + vec2f(seed, seed * 2.0));
  var col = mix(vec3f(0.46, 0.42, 0.30), vec3f(0.78, 0.73, 0.52), tone);
  if (variant > 0.5 && variant < 1.5) {
    col = mix(vec3f(0.18, 0.36, 0.34), vec3f(0.62, 0.74, 0.63), tone);
  } else if (variant >= 1.5) {
    col = mix(vec3f(0.25, 0.20, 0.18), vec3f(0.52, 0.47, 0.38), tone);
  }
  col = col + vec3f((fbm(uv.x * 26.0 + seed, uv.y * 26.0, 5.0) * 0.5) * 0.16);
  col = mix(col, vec3f(0.08, 0.07, 0.055), seam_mark * 0.76);
  col = col - vec3f(crack_field(uv + vec2f(0.1, 0.0), seed, 8.0) * 0.26);
  col = mix(col, vec3f(0.025, 0.020, 0.018), (1.0 - smoothstep(0.025, 0.075, length(uv - vec2f(0.67, 0.42)))) * 0.82);
  return sat3(col - vec3f(speckle(px, 2.4, seed, 0.88) * 0.08));
}

fn bath_tile(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let grid = uv * (5.0 + variant);
  let cell = floor(grid);
  let local = fract(grid);
  let grout = max(1.0 - smoothstep(0.045, 0.075, min(local.x, 1.0 - local.x)), 1.0 - smoothstep(0.045, 0.075, min(local.y, 1.0 - local.y)));
  let shade = rand(cell + vec2f(seed, seed));
  var col = mix(vec3f(0.66, 0.69, 0.63), vec3f(0.93, 0.91, 0.82), shade);
  if (variant > 0.5 && variant < 1.5) {
    col = mix(vec3f(0.42, 0.57, 0.55), vec3f(0.76, 0.87, 0.82), shade);
  } else if (variant >= 1.5) {
    col = mix(vec3f(0.38, 0.32, 0.28), vec3f(0.72, 0.65, 0.55), shade);
  }
  let mildew = grout * (0.45 + 0.55 * smoothstep(0.35, 0.70, fbm(uv.x * 13.0 + seed, uv.y * 13.0, 4.0) * 0.5 + 0.5));
  col = mix(col, vec3f(0.020, 0.055, 0.030), mildew * 0.82);
  col = mix(col, vec3f(0.55, 0.20, 0.055), vertical_drips(uv - vec2f(0.10, 0.0), seed + 5.0, 1.0) * smoothstep(0.40, 1.4, variant) * 0.58);
  return sat3(col - vec3f(crack_field(uv, seed, 11.0) * 0.18 + speckle(px, 1.8, seed, 0.94) * 0.11));
}

fn mildew_brick(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var col = brick(uv, px, 1.0, seed);
  let damp = smoothstep(0.40, 0.96, uv.y);
  let green = smoothstep(0.42, 0.70, fbm(uv.x * 6.0 + seed, uv.y * 9.0, 5.0) * 0.5 + 0.5) * damp;
  let black = smoothstep(0.64, 0.90, fbm(uv.x * 12.0 - seed, uv.y * 8.0 + seed, 4.0) * 0.5 + 0.5) * (0.4 + variant * 0.3);
  col = mix(col, vec3f(0.050, 0.12, 0.045), green * 0.62);
  col = mix(col, vec3f(0.030, 0.025, 0.020), black * 0.44);
  return sat3(mix(col, vec3f(0.82, 0.80, 0.68), speckle(px, 6.0, seed, 0.94) * smoothstep(1.0, 1.8, variant) * 0.58));
}

fn rot_siding(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let planks = 5.0 + variant;
  let plank_id = floor(uv.x * planks);
  let local_x = fract(uv.x * planks);
  let seam_mark = 1.0 - smoothstep(0.025, 0.055, min(local_x, 1.0 - local_x));
  let board_tone = rand(vec2f(plank_id, seed));
  var wood_col = mix(vec3f(0.28, 0.17, 0.09), vec3f(0.58, 0.39, 0.20), board_tone);
  wood_col = wood_col + vec3f(line_near(sin((uv.y + fbm(uv.x * 4.0 + seed, uv.y * 8.0, 4.0) * 0.05) * 90.0), 0.12) * 0.055);
  var paint = vec3f(0.58, 0.62, 0.54);
  if (variant > 0.5 && variant < 1.5) { paint = vec3f(0.28, 0.47, 0.58); }
  else if (variant >= 1.5) { paint = vec3f(0.70, 0.56, 0.35); }
  let peel = smoothstep(0.52, 0.68, fbm(uv.x * 7.0 + seed, uv.y * 5.0 - seed, 5.0) * 0.5 + 0.5);
  var col = mix(paint, wood_col, peel);
  let rot = smoothstep(0.46, 0.92, uv.y) * smoothstep(0.40, 0.72, fbm(uv.x * 9.0, uv.y * 6.0 + seed, 4.0) * 0.5 + 0.5);
  col = mix(col, vec3f(0.035, 0.040, 0.026), rot * 0.78);
  col = mix(col, vec3f(0.018, 0.016, 0.014), seam_mark * 0.80);
  return sat3(col - vec3f(vertical_drips(uv, seed, variant) * 0.20 + speckle(px, 3.0, seed, 0.90) * 0.10));
}

fn rust_sheet(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let corr = sin(uv.x * (55.0 + variant * 16.0));
  let ridge = corr * 0.5 + 0.5;
  var metal = mix(vec3f(0.25, 0.27, 0.26), vec3f(0.61, 0.62, 0.57), ridge * 0.45 + 0.25);
  metal = metal + vec3f((fbm(uv.x * 18.0 + seed, uv.y * 18.0, 4.0) * 0.5 - 0.25) * 0.11);
  let rust_noise = fbm(uv.x * 8.0 + seed, uv.y * 8.0 - seed, 5.0) * 0.5 + 0.5;
  let rust = smoothstep(0.45 - variant * 0.05, 0.76, rust_noise);
  var col = mix(metal, mix(vec3f(0.26, 0.08, 0.025), vec3f(0.78, 0.30, 0.065), rust_noise), rust * 0.85);
  col = mix(col, vec3f(0.64, 0.18, 0.035), vertical_drips(uv, seed + 3.0, variant + 1.0) * 0.55);
  col = mix(col, vec3f(0.055, 0.050, 0.042), speckle(px, 5.5, seed, 0.94) * rust * 0.72);
  return sat3(col - vec3f(line_near(corr, 0.030) * 0.08));
}

fn blade_steel(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let broad = fbm(uv.x * 5.0 + seed, uv.y * 8.0 - seed, 4.0) * 0.5 + 0.5;
  let brush = sin((uv.x + fbm(uv.x * 7.0, uv.y * 4.0 + seed, 3.0) * 0.035) * (180.0 + variant * 28.0)) * 0.5 + 0.5;
  var low = vec3f(0.34, 0.36, 0.36);
  var high = vec3f(0.82, 0.84, 0.80);
  if (variant > 0.5 && variant < 1.5) {
    low = vec3f(0.18, 0.20, 0.21);
    high = vec3f(0.54, 0.57, 0.56);
  } else if (variant >= 1.5) {
    low = vec3f(0.42, 0.36, 0.29);
    high = vec3f(0.78, 0.72, 0.62);
  }
  var col = mix(low, high, broad * 0.44 + brush * 0.34 + 0.12);
  let bevel = line_near(uv.y - 0.76 + snoise(uv.x * 4.0 + seed, seed) * 0.018, 0.026);
  let spine = line_near(uv.y - 0.22 + snoise(uv.x * 3.0 - seed, seed) * 0.014, 0.014);
  let scratch = line_near(snoise(uv.x * 12.0 + seed, uv.y * 42.0 - seed), 0.014) * smoothstep(0.25, 0.80, fbm(uv.x * 4.0, uv.y * 4.0 + seed, 4.0) * 0.5 + 0.5);
  let nick = speckle(px, 5.0, seed, 0.955) * smoothstep(0.66, 0.95, uv.y);
  col = mix(col, vec3f(0.95, 0.96, 0.90), bevel * 0.45 + spine * 0.22);
  col = col + vec3f(0.18, 0.18, 0.16) * scratch - vec3f(0.24, 0.22, 0.18) * nick;
  if (variant >= 1.5) {
    let tarnish = blotch(uv, vec2f(0.25, 0.72), 0.16, vec2f(1.6, 0.7), seed + 8.0) + blotch(uv, vec2f(0.72, 0.30), 0.12, vec2f(1.2, 1.0), seed + 11.0);
    col = mix(col, vec3f(0.40, 0.17, 0.055), sat(tarnish) * 0.22);
  }
  return sat3(col);
}

fn gunmetal(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let fine = fbm(uv.x * 20.0 + seed, uv.y * 20.0, 4.0) * 0.5 + 0.5;
  let oil = fbm(uv.x * 4.0 - seed, uv.y * 5.0 + seed, 5.0) * 0.5 + 0.5;
  var low = vec3f(0.045, 0.052, 0.060);
  var high = vec3f(0.25, 0.29, 0.31);
  if (variant > 0.5 && variant < 1.5) {
    low = vec3f(0.070, 0.075, 0.070);
    high = vec3f(0.34, 0.35, 0.31);
  } else if (variant >= 1.5) {
    low = vec3f(0.10, 0.105, 0.105);
    high = vec3f(0.50, 0.50, 0.45);
  }
  var col = mix(low, high, fine * 0.44 + oil * 0.22);
  let slide_groove = line_near(sin((uv.y + snoise(uv.x * 2.0, seed) * 0.010) * (74.0 + variant * 12.0)), 0.050);
  let machining = line_near(sin(uv.x * (120.0 + variant * 30.0)), 0.070);
  let holster_wear = smoothstep(0.57, 0.93, uv.x) * smoothstep(0.35, 0.82, uv.y);
  let scratch = line_near(snoise(uv.x * 18.0 + seed, uv.y * 28.0 - seed), 0.016);
  col = col + vec3f(0.055, 0.060, 0.055) * slide_groove + vec3f(0.030, 0.032, 0.030) * machining;
  col = mix(col, vec3f(0.58, 0.57, 0.50), holster_wear * speckle(px, 3.0, seed, 0.90) * (0.28 + variant * 0.08));
  col = col + vec3f(0.14, 0.13, 0.11) * scratch - vec3f(speckle(px, 4.0, seed + 4.0, 0.94) * 0.10);
  return sat3(col);
}

fn grip_polymer(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var low = vec3f(0.028, 0.030, 0.034);
  var high = vec3f(0.18, 0.19, 0.19);
  if (variant > 0.5 && variant < 1.5) {
    low = vec3f(0.080, 0.070, 0.055);
    high = vec3f(0.32, 0.28, 0.20);
  } else if (variant >= 1.5) {
    low = vec3f(0.030, 0.060, 0.055);
    high = vec3f(0.16, 0.24, 0.20);
  }
  let grain = fbm(uv.x * 26.0 + seed, uv.y * 26.0 - seed, 4.0) * 0.5 + 0.5;
  var col = mix(low, high, grain * 0.54 + 0.10);
  let diag_a = abs(fract((uv.x + uv.y) * (9.0 + variant * 2.0)) - 0.5);
  let diag_b = abs(fract((uv.x - uv.y) * (9.0 + variant * 2.0)) - 0.5);
  let diamond = 1.0 - smoothstep(0.045, 0.082, min(diag_a, diag_b));
  let stipple = speckle(px, 2.6 - variant * 0.25, seed, 0.66 + variant * 0.04);
  let worn_high = speckle(px + vec2f(21.0, 13.0), 4.0, seed, 0.93);
  col = col + vec3f(0.10, 0.10, 0.09) * diamond + vec3f(0.055, 0.055, 0.050) * stipple;
  col = mix(col, vec3f(0.42, 0.41, 0.36), worn_high * smoothstep(1.0, 1.8, variant) * 0.38);
  return sat3(col);
}

fn leather(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let pore = fbm(uv.x * 30.0 + seed, uv.y * 26.0 - seed, 5.0) * 0.5 + 0.5;
  let wrinkle = line_near(snoise(uv.x * 8.0 + seed, uv.y * 19.0 - seed), 0.022);
  var low = vec3f(0.17, 0.075, 0.030);
  var high = vec3f(0.58, 0.28, 0.11);
  if (variant > 0.5 && variant < 1.5) {
    low = vec3f(0.030, 0.026, 0.022);
    high = vec3f(0.24, 0.21, 0.17);
  } else if (variant >= 1.5) {
    low = vec3f(0.42, 0.25, 0.12);
    high = vec3f(0.78, 0.52, 0.25);
  }
  var col = mix(low, high, pore * 0.58 + 0.20);
  let crease = line_near(snoise(uv.x * 13.0 - seed, uv.y * 9.0 + seed), 0.018);
  let seam = line_near(uv.x - 0.18, 0.010) * smoothstep(0.25, 0.85, uv.y);
  let stitch = seam * step(0.55, fract(uv.y * 18.0 + variant * 0.3));
  col = col - vec3f(0.16, 0.10, 0.06) * wrinkle - vec3f(0.12, 0.075, 0.040) * crease;
  col = mix(col, vec3f(0.86, 0.69, 0.48), stitch * 0.72);
  col = mix(col, vec3f(0.95, 0.72, 0.38), speckle(px, 6.0, seed, 0.95) * smoothstep(1.0, 1.8, variant) * 0.40);
  return sat3(col);
}

fn denim(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let weave_a = line_near(sin((uv.x + uv.y * 0.62) * (106.0 + variant * 12.0)), 0.13);
  let weave_b = line_near(sin((uv.y - uv.x * 0.20) * (82.0 + variant * 8.0)), 0.11);
  let fade = fbm(uv.x * 5.0 + seed, uv.y * 5.0 - seed, 4.0) * 0.5 + 0.5;
  var low = vec3f(0.025, 0.075, 0.18);
  var high = vec3f(0.18, 0.35, 0.62);
  if (variant > 0.5 && variant < 1.5) {
    low = vec3f(0.020, 0.024, 0.032);
    high = vec3f(0.18, 0.20, 0.24);
  } else if (variant >= 1.5) {
    low = vec3f(0.18, 0.23, 0.30);
    high = vec3f(0.56, 0.66, 0.76);
  }
  var col = mix(low, high, fade * 0.48 + weave_a * 0.18 + weave_b * 0.10);
  let fray = line_near(snoise(uv.x * 20.0 + seed, uv.y * 6.0 - seed), 0.020) * smoothstep(0.55, 0.94, uv.x);
  let lint = speckle(px, 3.0, seed, 0.92);
  col = mix(col, vec3f(0.72, 0.78, 0.82), fray * 0.36 + lint * 0.18);
  return sat3(col);
}

fn fabric_fill(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let warp = line_near(sin((uv.x + fbm(uv.x * 2.0 + seed, uv.y * 2.0, 3.0) * 0.020) * 95.0), 0.10);
  let weft = line_near(sin((uv.y + fbm(uv.x * 2.0, uv.y * 2.0 - seed, 3.0) * 0.020) * 88.0), 0.11);
  let weave = sat(warp * 0.58 + weft * 0.48);
  var col = mix(vec3f(0.16, 0.22, 0.12), vec3f(0.48, 0.55, 0.34), weave);
  if (variant > 0.5 && variant < 1.5) {
    let stripe_a = line_near(sin(uv.x * 28.0), 0.13);
    let stripe_b = line_near(sin(uv.y * 19.0), 0.12);
    col = mix(vec3f(0.16, 0.08, 0.09), vec3f(0.70, 0.58, 0.42), weave * 0.40 + stripe_a * 0.32);
    col = mix(col, vec3f(0.08, 0.12, 0.17), stripe_b * 0.36);
  } else if (variant >= 1.5) {
    let camo_a = blotch(uv, vec2f(0.24, 0.36), 0.22, vec2f(1.4, 0.8), seed);
    let camo_b = blotch(uv, vec2f(0.70, 0.68), 0.20, vec2f(0.9, 1.5), seed + 5.0);
    let camo_c = blotch(uv, vec2f(0.58, 0.22), 0.15, vec2f(1.2, 1.0), seed + 8.0);
    col = mix(vec3f(0.18, 0.22, 0.14), vec3f(0.44, 0.40, 0.24), weave * 0.25);
    col = mix(col, vec3f(0.08, 0.13, 0.08), camo_a * 0.68);
    col = mix(col, vec3f(0.38, 0.31, 0.18), camo_b * 0.58);
    col = mix(col, vec3f(0.055, 0.060, 0.050), camo_c * 0.50);
  }
  col = col + vec3f((fbm(uv.x * 18.0 + seed, uv.y * 18.0, 4.0) - 0.5) * 0.070) - vec3f(speckle(px, 3.0, seed, 0.93) * 0.060);
  return sat3(col);
}

fn skin_fill(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let mottle = fbm(uv.x * 7.0 + seed, uv.y * 8.0 - seed, 5.0) * 0.5 + 0.5;
  let pore_noise = fbm(uv.x * 42.0 - seed, uv.y * 39.0 + seed, 4.0) * 0.5 + 0.5;
  var low = vec3f(0.70, 0.43, 0.31);
  var high = vec3f(0.98, 0.72, 0.55);
  if (variant > 0.5 && variant < 1.5) {
    low = vec3f(0.42, 0.23, 0.16);
    high = vec3f(0.76, 0.48, 0.32);
  } else if (variant >= 1.5) {
    low = vec3f(0.18, 0.095, 0.065);
    high = vec3f(0.44, 0.25, 0.16);
  }
  var col = mix(low, high, mottle * 0.58 + pore_noise * 0.10 + 0.14);
  let pore = speckle(px, 2.2, seed, 0.80) * 0.055;
  let freckle = speckle(px + vec2f(17.0, 31.0), 6.5, seed, 0.965) * smoothstep(0.0, 1.1, 1.2 - variant * 0.25);
  let crease = line_near(snoise(uv.x * 10.0 + seed, uv.y * 15.0 - seed), 0.014) * smoothstep(0.40, 0.86, fbm(uv.x * 4.0, uv.y * 4.0 + seed, 3.0) * 0.5 + 0.5);
  let scar = line_near(uv.y - 0.42 - sin(uv.x * 9.0 + seed) * 0.025, 0.010) * smoothstep(1.0, 1.8, variant);
  col = col - vec3f(pore) - vec3f(0.18, 0.09, 0.04) * freckle;
  col = mix(col, vec3f(0.54, 0.24, 0.18), crease * 0.16);
  col = mix(col, vec3f(0.84, 0.60, 0.48), scar * 0.34);
  return sat3(col);
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

fn peel_wallpaper_vice(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let stripe = line_near(sin(uv.x * (32.0 + variant * 8.0)), 0.18);
  let flourish = line_near(sin((uv.x * 18.0 + sin(uv.y * 21.0 + seed) * 2.0) + seed), 0.09) * line_near(sin(uv.y * 23.0), 0.13);
  var paper_a = vec3f(0.95, 0.40, 0.66);
  var paper_b = vec3f(0.16, 0.84, 0.86);
  if (variant > 0.5 && variant < 1.5) {
    paper_a = vec3f(0.84, 0.70, 0.25);
    paper_b = vec3f(0.14, 0.62, 0.70);
  } else if (variant >= 1.5) {
    paper_a = vec3f(0.78, 0.52, 0.82);
    paper_b = vec3f(0.13, 0.17, 0.26);
  }
  let age = fbm(uv.x * 7.0 + seed, uv.y * 7.0 - seed, 5.0) * 0.5 + 0.5;
  var col = mix(paper_b, paper_a, stripe * 0.55 + flourish * 0.34 + age * 0.20);
  let peel = smoothstep(0.48 - variant * 0.04, 0.67, fbm(uv.x * 5.0 + seed, uv.y * 6.0 - seed, 5.0) * 0.5 + 0.5);
  let curl_edge = line_near(fbm(uv.x * 7.0 + seed, uv.y * 8.0, 4.0) - 0.42, 0.025);
  let plaster = mix(vec3f(0.31, 0.27, 0.22), vec3f(0.65, 0.58, 0.46), age);
  col = mix(col, plaster, peel * 0.72);
  col = mix(col, vec3f(0.95, 0.86, 0.62), curl_edge * peel * 0.45);
  col = mix(col, vec3f(0.025, 0.055, 0.030), blotch(uv, vec2f(0.24, 0.78), 0.18, vec2f(1.4, 0.8), seed) * 0.58);
  return neon_grime(uv, px, col, seed, variant);
}

fn motel_carpet(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let pile = fbm(uv.x * 34.0 + seed, uv.y * 34.0 - seed, 5.0) * 0.5 + 0.5;
  let zig_a = line_near(sin((uv.x + uv.y) * (42.0 + variant * 5.0)), 0.16);
  let zig_b = line_near(sin((uv.x - uv.y) * (38.0 + variant * 6.0)), 0.16);
  var base = mix(vec3f(0.10, 0.08, 0.20), vec3f(0.34, 0.12, 0.40), pile);
  if (variant > 0.5 && variant < 1.5) {
    base = mix(vec3f(0.06, 0.21, 0.22), vec3f(0.18, 0.48, 0.44), pile);
  } else if (variant >= 1.5) {
    base = mix(vec3f(0.22, 0.10, 0.06), vec3f(0.72, 0.34, 0.16), pile);
  }
  var col = mix(base, vec3f(0.95, 0.17, 0.55), zig_a * 0.28);
  col = mix(col, vec3f(0.08, 0.88, 0.86), zig_b * 0.20);
  let burn = blotch(uv, vec2f(0.34, 0.52), 0.11, vec2f(1.0, 0.8), seed + 4.0);
  let stain = blotch(uv, vec2f(0.72, 0.70), 0.20, vec2f(0.7, 1.3), seed + 9.0);
  col = mix(col, vec3f(0.018, 0.014, 0.012), burn * 0.62);
  col = mix(col, vec3f(0.13, 0.08, 0.035), stain * 0.45);
  col = mix(col, vec3f(0.70, 0.74, 0.60), speckle(px, 4.5, seed, 0.95) * 0.34);
  return neon_grime(uv, px, col, seed + 2.0, variant);
}

fn rotten_rug(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let border_x = max(1.0 - smoothstep(0.055, 0.12, min(uv.x, 1.0 - uv.x)), 0.0);
  let border_y = max(1.0 - smoothstep(0.055, 0.12, min(uv.y, 1.0 - uv.y)), 0.0);
  let border = sat(border_x + border_y);
  let medallion = line_near(length((uv - vec2f(0.5, 0.5)) * vec2f(1.0, 1.35)) - 0.24, 0.030);
  let thread = fbm(uv.x * 28.0 + seed, uv.y * 24.0 - seed, 5.0) * 0.5 + 0.5;
  var col = mix(vec3f(0.18, 0.035, 0.09), vec3f(0.58, 0.12, 0.23), thread);
  if (variant > 0.5 && variant < 1.5) {
    col = mix(vec3f(0.08, 0.18, 0.20), vec3f(0.28, 0.66, 0.62), thread);
  } else if (variant >= 1.5) {
    col = mix(vec3f(0.20, 0.14, 0.06), vec3f(0.72, 0.58, 0.24), thread);
  }
  col = mix(col, vec3f(0.96, 0.68, 0.22), border * 0.44);
  col = mix(col, vec3f(0.05, 0.82, 0.90), medallion * 0.32);
  let worn = smoothstep(0.45, 0.76, fbm(uv.x * 8.0 - seed, uv.y * 8.0 + seed, 5.0) * 0.5 + 0.5);
  let fray = (speckle(px, 2.4, seed, 0.78) + line_near(snoise(uv.x * 30.0, uv.y * 10.0 + seed), 0.018)) * smoothstep(0.55, 0.95, border);
  col = mix(col, vec3f(0.20, 0.18, 0.14), worn * 0.45);
  col = mix(col, vec3f(0.82, 0.78, 0.58), fray * 0.28);
  return neon_grime(uv, px, col, seed + 5.0, variant);
}

fn neon_stucco(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let stucco = fbm(uv.x * 28.0 + seed, uv.y * 28.0 - seed, 5.0) * 0.5 + 0.5;
  let larger = fbm(uv.x * 5.0 - seed, uv.y * 5.0 + seed, 4.0) * 0.5 + 0.5;
  var low = vec3f(0.50, 0.10, 0.24);
  var high = vec3f(0.98, 0.45, 0.66);
  if (variant > 0.5 && variant < 1.5) {
    low = vec3f(0.07, 0.37, 0.42);
    high = vec3f(0.36, 0.92, 0.88);
  } else if (variant >= 1.5) {
    low = vec3f(0.26, 0.19, 0.46);
    high = vec3f(0.84, 0.68, 0.96);
  }
  var col = mix(low, high, stucco * 0.62 + larger * 0.18);
  col = col - vec3f(crack_field(uv, seed, 9.0) * 0.18);
  col = mix(col, vec3f(0.98, 0.78, 0.18), vertical_drips(uv, seed + 2.0, variant + 1.0) * 0.18);
  return neon_grime(uv, px, col, seed + 6.0, variant);
}

fn pool_tile_vice(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let grid = uv * (vec2f(6.0, 6.0) + vec2f(variant, variant * 0.5));
  let cell = floor(grid);
  let local = fract(grid);
  let grout = max(1.0 - smoothstep(0.035, 0.070, min(local.x, 1.0 - local.x)), 1.0 - smoothstep(0.035, 0.070, min(local.y, 1.0 - local.y)));
  let tile_tone = rand(cell + vec2f(seed, seed * 2.0));
  var col = mix(vec3f(0.05, 0.50, 0.62), vec3f(0.48, 0.96, 0.92), tile_tone);
  if (variant > 0.5 && variant < 1.5) {
    col = mix(vec3f(0.12, 0.10, 0.42), vec3f(0.96, 0.20, 0.56), tile_tone);
  } else if (variant >= 1.5) {
    col = mix(vec3f(0.16, 0.44, 0.34), vec3f(0.86, 0.74, 0.34), tile_tone);
  }
  let caustic = line_near(sin(uv.x * 50.0 + uv.y * 17.0 + U.time * 0.8 + seed), 0.055);
  let mildew = grout * smoothstep(0.40, 0.82, fbm(uv.x * 15.0 + seed, uv.y * 15.0, 4.0) * 0.5 + 0.5);
  col = mix(col, vec3f(0.90, 1.0, 0.85), caustic * 0.18);
  col = mix(col, vec3f(0.015, 0.050, 0.035), mildew * 0.78);
  return neon_grime(uv, px, col, seed + 8.0, variant);
}

fn booth_vinyl(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let rib = line_near(sin((uv.x + sin(uv.y * 4.0 + seed) * 0.012) * (45.0 + variant * 11.0)), 0.12);
  let sheen = smoothstep(0.36, 0.96, sin((uv.x * 1.2 + uv.y * 1.6 + seed) * 6.0) * 0.5 + 0.5);
  var col = mix(vec3f(0.34, 0.025, 0.12), vec3f(0.92, 0.08, 0.40), rib * 0.40 + sheen * 0.24);
  if (variant > 0.5 && variant < 1.5) {
    col = mix(vec3f(0.025, 0.16, 0.18), vec3f(0.08, 0.78, 0.76), rib * 0.40 + sheen * 0.24);
  } else if (variant >= 1.5) {
    col = mix(vec3f(0.24, 0.14, 0.03), vec3f(0.92, 0.62, 0.16), rib * 0.34 + sheen * 0.25);
  }
  let seam = line_near(uv.x - 0.50, 0.014) + line_near(uv.y - 0.50, 0.014);
  let tear = line_near(snoise(uv.x * 11.0 + seed, uv.y * 18.0 - seed), 0.015) * smoothstep(0.46, 0.78, fbm(uv.x * 6.0, uv.y * 6.0 + seed, 4.0) * 0.5 + 0.5);
  col = mix(col, vec3f(0.03, 0.02, 0.018), sat(seam) * 0.46 + tear * 0.62);
  col = mix(col, vec3f(0.86, 0.82, 0.66), speckle(px, 4.0, seed, 0.94) * 0.26);
  return neon_grime(uv, px, col, seed + 10.0, variant);
}

fn drop_ceiling(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let grid = uv * vec2f(3.0 + variant * 0.5, 4.0);
  let local = fract(grid);
  let seam_mark = max(1.0 - smoothstep(0.018, 0.050, min(local.x, 1.0 - local.x)), 1.0 - smoothstep(0.018, 0.050, min(local.y, 1.0 - local.y)));
  let fiber = fbm(uv.x * 38.0 + seed, uv.y * 34.0 - seed, 5.0) * 0.5 + 0.5;
  var col = mix(vec3f(0.52, 0.46, 0.38), vec3f(0.86, 0.78, 0.62), fiber);
  if (variant > 0.5 && variant < 1.5) {
    col = mix(vec3f(0.42, 0.28, 0.32), vec3f(0.82, 0.62, 0.72), fiber);
  } else if (variant >= 1.5) {
    col = mix(vec3f(0.30, 0.38, 0.34), vec3f(0.70, 0.82, 0.70), fiber);
  }
  let water_ring = line_near(length((uv - vec2f(0.34, 0.38)) * vec2f(1.2, 0.8)) - 0.20, 0.028);
  let sag = smoothstep(0.52, 0.90, fbm(uv.x * 5.0 + seed, uv.y * 5.0, 4.0) * 0.5 + 0.5);
  col = mix(col, vec3f(0.10, 0.075, 0.045), water_ring * 0.58 + sag * 0.20);
  col = mix(col, vec3f(0.055, 0.050, 0.045), seam_mark * 0.66);
  return neon_grime(uv, px, col, seed + 12.0, variant);
}

fn pdx_carpet(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  let pile = fbm(uv.x * 32.0 + seed, uv.y * 32.0 - seed, 5.0) * 0.5 + 0.5;
  let low_thread = line_near(sin((uv.x * 1.8 + uv.y) * 92.0), 0.13);
  var base_a = vec3f(0.015, 0.23, 0.24);
  var base_b = vec3f(0.04, 0.48, 0.48);
  if (variant > 0.5 && variant < 1.5) {
    base_a = vec3f(0.018, 0.14, 0.19);
    base_b = vec3f(0.06, 0.36, 0.46);
  } else if (variant >= 1.5) {
    base_a = vec3f(0.10, 0.20, 0.16);
    base_b = vec3f(0.35, 0.50, 0.34);
  }
  var col = mix(base_a, base_b, pile * 0.62 + low_thread * 0.12);

  let taxi_shadow =
    segment_mark(uv, vec2f(0.10, 0.80), vec2f(0.88, 0.18), 0.037) +
    segment_mark(uv, vec2f(0.17, 0.35), vec2f(0.82, 0.64), 0.030) +
    segment_mark(uv, vec2f(0.45, 0.54), vec2f(0.47, 0.14), 0.026) +
    segment_mark(uv, vec2f(0.36, 0.44), vec2f(0.20, 0.18), 0.023) +
    segment_mark(uv, vec2f(0.58, 0.43), vec2f(0.82, 0.34), 0.023);
  col = mix(col, vec3f(0.010, 0.045, 0.050), sat(taxi_shadow) * 0.62);

  let main_lane = segment_mark(uv, vec2f(0.10, 0.80), vec2f(0.88, 0.18), 0.020);
  let cross_lane = segment_mark(uv, vec2f(0.17, 0.35), vec2f(0.82, 0.64), 0.014);
  let tower_lane = segment_mark(uv, vec2f(0.45, 0.54), vec2f(0.47, 0.14), 0.012);
  let west_lane = segment_mark(uv, vec2f(0.36, 0.44), vec2f(0.20, 0.18), 0.010);
  let east_lane = segment_mark(uv, vec2f(0.58, 0.43), vec2f(0.82, 0.34), 0.010);
  col = mix(col, vec3f(0.10, 0.95, 0.92), main_lane * 0.78);
  col = mix(col, vec3f(0.18, 0.34, 0.95), cross_lane * 0.68);
  col = mix(col, vec3f(0.94, 0.12, 0.50), tower_lane * 0.64);
  col = mix(col, vec3f(0.96, 0.68, 0.16), west_lane * 0.62);
  col = mix(col, vec3f(0.72, 0.24, 0.96), east_lane * 0.58);

  let node_a = dot_mark(uv, vec2f(0.45, 0.54), 0.034);
  let node_b = dot_mark(uv, vec2f(0.27, 0.66), 0.022);
  let node_c = dot_mark(uv, vec2f(0.70, 0.32), 0.025);
  let node_d = dot_mark(uv, vec2f(0.82, 0.64), 0.019);
  col = mix(col, vec3f(0.92, 0.96, 0.72), node_a * 0.82);
  col = mix(col, vec3f(0.95, 0.20, 0.18), node_b * 0.70);
  col = mix(col, vec3f(0.06, 0.95, 0.72), node_c * 0.72);
  col = mix(col, vec3f(0.88, 0.60, 0.96), node_d * 0.62);

  let scuff = blotch(uv, vec2f(0.63, 0.70), 0.15, vec2f(1.5, 0.7), seed + 2.0);
  let gum = dot_mark(uv, vec2f(0.23, 0.78), 0.025) * smoothstep(1.0, 1.8, variant);
  let worn_track = segment_mark(uv, vec2f(0.08, 0.52), vec2f(0.92, 0.56), 0.040) * speckle(px, 3.0, seed, 0.76);
  col = mix(col, vec3f(0.07, 0.09, 0.08), scuff * 0.34 + worn_track * 0.20);
  col = mix(col, vec3f(0.62, 0.58, 0.48), gum * 0.72);
  return neon_grime(uv, px, col, seed + 16.0, variant);
}

// ── Board E / Neon Surface — the Drive/Miami "dream" pole ─────────────────────
// Claude's contribution. Where codex's boards lean into the Spun squalor (grime,
// rot, condemned interiors), these are the glossy neon exterior surfaces scape3d's
// thingymajiggers actually have no rich fill for yet: building faces, signage,
// sky, wet streets, vehicle bodies, screens, foliage. The duality TONE.md mandates
// needs BOTH poles; codex shipped the squalor, this ships the dream.

fn stucco_facade(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Pastel stucco wall + lit window grid + neon rim. The canonical CityBuilding /
  // Storefront face — a richer replacement for textures.ts facadeTex.
  let mottle = fbm(uv.x * 9.0 + seed, uv.y * 9.0 - seed, 5.0) * 0.5 + 0.5;
  var wall_lo = vec3f(0.42, 0.20, 0.30);
  var wall_hi = vec3f(0.86, 0.52, 0.62);
  var neon = vec3f(0.98, 0.24, 0.62);
  if (variant > 0.5 && variant < 1.5) {
    wall_lo = vec3f(0.10, 0.30, 0.34);
    wall_hi = vec3f(0.34, 0.74, 0.74);
    neon = vec3f(0.10, 0.92, 0.92);
  } else if (variant >= 1.5) {
    wall_lo = vec3f(0.30, 0.22, 0.46);
    wall_hi = vec3f(0.62, 0.50, 0.84);
    neon = vec3f(0.66, 0.36, 0.98);
  }
  let wall = mix(wall_lo, wall_hi, mottle * 0.6 + 0.2);
  let grid = uv * vec2f(4.0, 6.0);
  let cell = floor(grid);
  let local = fract(grid);
  let frame = max(1.0 - smoothstep(0.10, 0.16, min(local.x, 1.0 - local.x)), 1.0 - smoothstep(0.10, 0.16, min(local.y, 1.0 - local.y)));
  let lit = step(0.46, rand(cell + vec2f(seed, seed * 2.0)));
  let pane_sheen = smoothstep(0.7, 0.95, 1.0 - local.y);
  var glass = mix(vec3f(0.04, 0.05, 0.08), neon, lit * (0.5 + pane_sheen * 0.5));
  glass = mix(glass, vec3f(0.06, 0.07, 0.10), (1.0 - lit) * 0.7);
  var col = mix(glass, wall, frame);
  let rim = max(1.0 - smoothstep(0.0, 0.03, uv.x), 1.0 - smoothstep(0.0, 0.03, 1.0 - uv.x));
  let rim2 = max(1.0 - smoothstep(0.0, 0.03, uv.y), 1.0 - smoothstep(0.0, 0.03, 1.0 - uv.y));
  col = mix(col, neon, sat(rim + rim2) * 0.85);
  return sat3(col - vec3f(speckle(px, 3.0, seed, 0.95) * 0.05));
}

fn neon_tube(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Buzzing bent-glass sign tube on a dark backing board — the Sign thingymajigger.
  let buzz = 0.85 + 0.15 * sin(U.time * 40.0 + seed) * step(0.5, fract(U.time * 7.0 + seed));
  var tube = vec3f(0.98, 0.18, 0.62);
  if (variant > 0.5 && variant < 1.5) { tube = vec3f(0.12, 0.92, 0.96); }
  else if (variant >= 1.5) { tube = vec3f(0.98, 0.58, 0.12); }
  var col = mix(vec3f(0.02, 0.02, 0.03), vec3f(0.06, 0.05, 0.07), fbm(uv.x * 8.0 + seed, uv.y * 8.0, 4.0) * 0.5 + 0.5);
  let path_y = 0.5 + sin(uv.x * 9.0 + seed) * 0.22;
  let d = abs(uv.y - path_y);
  let core = 1.0 - smoothstep(0.012, 0.022, d);
  let glow = exp(-d * 26.0);
  let path_y2 = 0.5 + sin(uv.x * 9.0 + seed + 3.14159) * 0.14;
  let d2 = abs(uv.y - path_y2);
  let glow2 = exp(-d2 * 30.0);
  col = col + tube * (glow * 0.6 + glow2 * 0.4) * buzz;
  col = col + vec3f(1.0, 1.0, 1.0) * core * buzz * 0.9;
  return sat3(col);
}

fn sunset_grad(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Outrun dusk: gradient sky, banded sun, reflective grid floor. The skybox /
  // backdrop the world-as-shader-quad wants behind the meshed city.
  var top = vec3f(0.10, 0.04, 0.26);
  var mid = vec3f(0.86, 0.22, 0.42);
  var sun_c = vec3f(1.0, 0.82, 0.30);
  var floor_c = vec3f(0.12, 0.02, 0.20);
  if (variant > 0.5 && variant < 1.5) {
    top = vec3f(0.02, 0.02, 0.10);
    mid = vec3f(0.20, 0.06, 0.34);
    sun_c = vec3f(0.62, 0.30, 0.78);
    floor_c = vec3f(0.02, 0.01, 0.08);
  } else if (variant >= 1.5) {
    top = vec3f(0.18, 0.20, 0.42);
    mid = vec3f(0.96, 0.56, 0.32);
    sun_c = vec3f(1.0, 0.92, 0.62);
    floor_c = vec3f(0.20, 0.10, 0.10);
  }
  let horizon = 0.62;
  var col = vec3f(0.0, 0.0, 0.0);
  if (uv.y < horizon) {
    col = mix(top, mid, uv.y / horizon);
    let sd = length((uv - vec2f(0.5, horizon - 0.04)) * vec2f(1.0, 1.25));
    let sun = 1.0 - smoothstep(0.16, 0.18, sd);
    let band = step(0.5, fract((horizon - uv.y) * 36.0));
    let band_mask = smoothstep(horizon - 0.04, horizon - 0.20, uv.y);
    col = mix(col, sun_c, sun * (1.0 - band * band_mask));
    col = col + sun_c * exp(-sd * 6.0) * 0.4;
  } else {
    let fy = (uv.y - horizon) / (1.0 - horizon);
    col = mix(mid * 0.5, floor_c, fy);
    let persp = fy + 0.05;
    let gx = line_near(fract((uv.x - 0.5) / persp * 6.0) - 0.5, 0.03);
    let gz = line_near(fract(fy * 8.0) - 0.5, 0.04);
    col = col + sun_c * sat(gx + gz) * (1.0 - fy) * 0.5;
  }
  return sat3(col);
}

fn wet_asphalt(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Night street with neon puddle reflections — the road zone after the dream
  // turns wet. variant 2 is an oil slick (rainbow interference).
  let grain = fbm(uv.x * 22.0 + seed, uv.y * 22.0 - seed, 5.0) * 0.5 + 0.5;
  var col = mix(vec3f(0.02, 0.02, 0.025), vec3f(0.09, 0.09, 0.10), grain);
  col = col + vec3f(0.06, 0.06, 0.06) * speckle(px, 2.5, seed, 0.94);
  let puddle = smoothstep(0.55, 0.75, fbm(uv.x * 4.0 + seed, uv.y * 4.0 - seed, 5.0) * 0.5 + 0.5);
  let smear = fbm(uv.x * 5.0 + seed * 2.0, uv.y * 1.2, 4.0) * 0.5 + 0.5;
  var neon = mix(vec3f(0.95, 0.12, 0.55), vec3f(0.10, 0.85, 0.92), smear);
  if (variant > 0.5 && variant < 1.5) {
    neon = mix(vec3f(0.10, 0.85, 0.92), vec3f(0.98, 0.62, 0.16), smear);
  } else if (variant >= 1.5) {
    let ang = fbm(uv.x * 7.0 + seed, uv.y * 7.0, 4.0);
    neon = vec3f(0.5 + 0.5 * sin(ang * 6.0), 0.5 + 0.5 * sin(ang * 6.0 + 2.0), 0.5 + 0.5 * sin(ang * 6.0 + 4.0));
  }
  let vstreak = 0.4 + 0.6 * (sin(uv.y * 30.0 + smear * 8.0) * 0.5 + 0.5);
  col = mix(col, neon, puddle * 0.55 * vstreak);
  col = col + vec3f(0.18, 0.18, 0.18) * puddle * smoothstep(0.7, 0.95, smear);
  return sat3(col);
}

fn car_paint(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Glossy vehicle body: environment reflection band + metal flake + edge
  // highlight. The vehicle AssetKind has no surface yet. 0 candy-red, 1 chrome,
  // 2 matte-black.
  let env_top = vec3f(0.34, 0.18, 0.46);
  let env_bot = vec3f(0.03, 0.03, 0.05);
  let env = mix(env_top, env_bot, smoothstep(0.0, 1.0, uv.y));
  let s = (uv.y - 0.40) * 7.0;
  let streak = exp(-s * s);
  let flake = speckle(px, 1.6, seed, 0.86) * 0.10;
  var col = vec3f(0.0, 0.0, 0.0);
  if (variant < 0.5) {
    col = vec3f(0.72, 0.06, 0.12) + env * 0.30 + vec3f(1.0, 0.7, 0.7) * streak * 0.7 + vec3f(flake, flake, flake);
  } else if (variant < 1.5) {
    col = env * 1.3 + vec3f(1.0, 1.0, 1.0) * streak * 0.9 + vec3f(flake, flake, flake);
  } else {
    col = vec3f(0.04, 0.04, 0.05) + env * 0.10 + vec3f(0.4, 0.4, 0.4) * streak * 0.25 + vec3f(flake, flake, flake) * 0.4;
  }
  col = col + vec3f(0.5, 0.5, 0.5) * (1.0 - smoothstep(0.0, 0.04, uv.y)) * 0.6;
  return sat3(col);
}

fn crt_screen(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Monitor / phone / darknet-cafe glow: phosphor scanlines, glyph-noise text
  // rows, triad mask, rolling refresh. The dead-internet surfaces rendered as a
  // texture. 0 terminal-green, 1 web-blue, 2 dead-static.
  let roll = U.time * 0.15;
  var phos = vec3f(0.10, 0.95, 0.30);
  var bg = vec3f(0.01, 0.04, 0.02);
  if (variant > 0.5 && variant < 1.5) { phos = vec3f(0.30, 0.70, 1.0); bg = vec3f(0.01, 0.02, 0.05); }
  else if (variant >= 1.5) { phos = vec3f(0.80, 0.80, 0.80); bg = vec3f(0.02, 0.02, 0.02); }
  let cols = 28.0;
  let rows = 18.0;
  let cell = floor(vec2f(uv.x * cols, uv.y * rows));
  var lit = step(0.55, rand(cell + vec2f(seed, floor(roll * 6.0))));
  lit = lit * step(0.25, rand(vec2f(cell.y, seed)));
  var col = mix(bg, phos, lit * (0.5 + 0.5 * rand(cell + vec2f(3.0, 7.0))));
  if (variant >= 1.5) {
    let snow = rand(px + vec2f(floor(U.time * 50.0), seed));
    col = mix(vec3f(snow, snow, snow), col, 0.2);
  }
  let scan = 0.7 + 0.3 * (sin((uv.y + roll) * rows * 6.2831) * 0.5 + 0.5);
  col = col * scan;
  let triad = fract(uv.x * cols * 3.0);
  let rgbmask = vec3f(smoothstep(0.66, 0.34, triad), 1.0 - abs(triad - 0.5) * 2.0, smoothstep(0.34, 0.66, triad));
  col = col * (0.7 + 0.3 * rgbmask);
  let cdist = length((uv - vec2f(0.5, 0.5)) * vec2f(1.1, 1.2));
  col = col * (1.0 - smoothstep(0.45, 0.72, cdist));
  return sat3(col);
}

fn palm_canopy(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Frond fan against dusk — the PalmTree thingymajiger's canopy face. 0 lush,
  // 1 dry, 2 silhouette (against a hotter sky).
  var sky = mix(vec3f(0.86, 0.34, 0.42), vec3f(0.18, 0.10, 0.34), uv.y);
  var frond_lo = vec3f(0.04, 0.22, 0.10);
  var frond_hi = vec3f(0.20, 0.62, 0.24);
  if (variant > 0.5 && variant < 1.5) {
    frond_lo = vec3f(0.24, 0.18, 0.06);
    frond_hi = vec3f(0.58, 0.46, 0.16);
  } else if (variant >= 1.5) {
    frond_lo = vec3f(0.02, 0.02, 0.04);
    frond_hi = vec3f(0.06, 0.07, 0.10);
    sky = mix(vec3f(0.98, 0.56, 0.30), vec3f(0.30, 0.14, 0.40), uv.y);
  }
  let center = vec2f(0.5, 0.92);
  let rel = uv - center;
  let ang = atan2(rel.x, -rel.y);
  let rad = length(rel * vec2f(1.0, 0.8));
  let blades = sin(ang * 9.0 + sin(rad * 6.0 + seed) * 1.5);
  let blade_mask = smoothstep(0.1, 0.5, blades) * smoothstep(0.92, 0.30, rad) * step(rad, 0.95);
  let serr = 0.7 + 0.3 * sin(rad * 60.0);
  let f = mix(frond_lo, frond_hi, smoothstep(0.0, 0.6, rad) * serr);
  var col = mix(sky, f, blade_mask);
  let trunk = (1.0 - smoothstep(0.02, 0.05, abs(rel.x))) * step(0.55, uv.y);
  col = mix(col, vec3f(0.22, 0.15, 0.08), trunk * 0.8);
  return sat3(col);
}

// ── Board F / Contraband & Consequence — the Spun "squalor" game-objects ──────
// Claude's contribution. Not environment grime (codex's Board B/D own that) but
// the loop's hands-on artifacts: the money sink, the dealt product (quality-
// graded), and the crime scene the investigation reads. These are surfaces for
// items/events/the Case, not walls.

fn cash_stack(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Banded stack of bills with a face (portrait + guilloche). The money asset.
  // 0 clean, 1 worn/dirty, 2 blood-spattered.
  let bills = 14.0;
  let edge = line_near(fract(uv.y * bills) - 0.5, 0.10);
  let paper = mix(vec3f(0.30, 0.42, 0.30), vec3f(0.52, 0.66, 0.50), fbm(uv.x * 10.0 + seed, uv.y * 40.0, 4.0) * 0.5 + 0.5);
  let face_zone = smoothstep(0.30, 0.45, uv.y);
  let guilloche = line_near(sin(uv.x * 60.0) * sin(uv.y * 55.0 + seed), 0.20);
  let portrait = 1.0 - smoothstep(0.10, 0.13, length((uv - vec2f(0.5, 0.72)) * vec2f(1.4, 1.0)));
  var face = mix(vec3f(0.20, 0.36, 0.24), vec3f(0.42, 0.60, 0.42), guilloche * 0.5 + 0.4);
  face = mix(face, vec3f(0.55, 0.68, 0.54), portrait * 0.5);
  var col = mix(paper, face, face_zone);
  col = col - vec3f(0.10, 0.10, 0.10) * edge;
  if (variant > 0.5 && variant < 1.5) {
    col = col * 0.7 + vec3f(0.05, 0.04, 0.0) * (fbm(uv.x * 8.0, uv.y * 8.0 + seed, 4.0) * 0.5 + 0.5);
  } else if (variant >= 1.5) {
    col = mix(col, vec3f(0.40, 0.02, 0.02), blotch(uv, vec2f(0.62, 0.40), 0.18, vec2f(1.0, 1.2), seed) * 0.7);
  }
  return sat3(col - vec3f(speckle(px, 3.0, seed, 0.95) * 0.05));
}

fn product_baggie(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Plastic baggie sheen over product — the dealing loop's quality grade made
  // visible. 0 crystal (glass), 1 fine powder, 2 pressed brick.
  var content = vec3f(0.82, 0.86, 0.92);
  if (variant < 0.5) {
    let g = uv * 9.0;
    let cidx = floor(g);
    let fl = fract(g);
    let facet = rand(cidx + vec2f(seed, seed * 2.0));
    let cedge = max(1.0 - smoothstep(0.0, 0.10, fl.x), 1.0 - smoothstep(0.0, 0.10, fl.y));
    content = mix(vec3f(0.60, 0.70, 0.82), vec3f(0.92, 0.98, 1.0), facet);
    content = content + vec3f(0.6, 0.6, 0.6) * cedge * step(0.6, facet);
  } else if (variant < 1.5) {
    content = mix(vec3f(0.80, 0.80, 0.84), vec3f(0.98, 0.97, 0.99), fbm(uv.x * 30.0 + seed, uv.y * 30.0, 5.0) * 0.5 + 0.5);
    content = content - vec3f(0.08, 0.08, 0.08) * speckle(px, 1.6, seed, 0.6);
  } else {
    content = mix(vec3f(0.46, 0.34, 0.22), vec3f(0.66, 0.50, 0.32), fbm(uv.x * 7.0 + seed, uv.y * 7.0, 4.0) * 0.5 + 0.5);
    let wrap = line_near(uv.x - 0.5, 0.02) + line_near(uv.y - 0.5, 0.02);
    content = content - vec3f(0.12, 0.12, 0.12) * sat(wrap);
  }
  let wrinkle = line_near(snoise(uv.x * 6.0 + seed, uv.y * 9.0 - seed), 0.02);
  let sheen = smoothstep(0.45, 0.5, abs(fract((uv.x + uv.y) * 1.5 + 0.2) - 0.5));
  var col = content + vec3f(0.10, 0.10, 0.10) * wrinkle;
  col = col + vec3f(0.22, 0.22, 0.22) * (1.0 - sheen) * 0.5;
  return sat3(col);
}

fn blood_pool(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Crime-scene spatter on a floor — what a MurderEvent leaves. 0 fresh (wet
  // specular), 1 dried (brown matte), 2 smear (directional drag).
  let floor_c = mix(vec3f(0.10, 0.10, 0.11), vec3f(0.16, 0.16, 0.17), fbm(uv.x * 14.0 + seed, uv.y * 14.0, 4.0) * 0.5 + 0.5);
  let blood = vec3f(0.34, 0.02, 0.02);
  var col = floor_c;
  let pool = blotch(uv, vec2f(0.5, 0.5), 0.26, vec2f(1.0, 0.85), seed);
  col = mix(col, blood, pool);
  let drops = sat(dot_mark(uv, vec2f(0.22, 0.30), 0.04) + dot_mark(uv, vec2f(0.78, 0.36), 0.03) + dot_mark(uv, vec2f(0.30, 0.78), 0.025) + dot_mark(uv, vec2f(0.70, 0.72), 0.035));
  col = mix(col, blood, drops);
  if (variant < 0.5) {
    let spec = 1.0 - smoothstep(0.0, 0.08, length((uv - vec2f(0.44, 0.44)) * vec2f(1.0, 1.0)));
    col = col + vec3f(0.5, 0.3, 0.3) * spec * pool;
    col = mix(col, vec3f(0.55, 0.03, 0.03), pool * 0.4);
  } else if (variant > 0.5 && variant < 1.5) {
    col = mix(col, vec3f(0.20, 0.05, 0.03), (pool + drops) * 0.6);
  } else {
    let smear = blotch(uv, vec2f(0.5, 0.5), 0.30, vec2f(0.5, 1.6), seed) * smoothstep(0.5, 0.9, uv.y);
    col = mix(col, vec3f(0.28, 0.03, 0.03), smear * 0.7);
  }
  return sat3(col);
}

fn evidence_tape(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // The investigation made physical. 0 hazard tape, 1 chalk outline on asphalt,
  // 2 numbered evidence marker (folded tent).
  if (variant < 0.5) {
    var col = mix(vec3f(0.05, 0.05, 0.06), vec3f(0.09, 0.09, 0.10), fbm(uv.x * 10.0 + seed, uv.y * 10.0, 4.0) * 0.5 + 0.5);
    let band = smoothstep(0.38, 0.40, uv.y) * smoothstep(0.62, 0.60, uv.y);
    let stripe = step(0.5, fract((uv.x - uv.y) * 9.0));
    col = mix(col, mix(vec3f(0.96, 0.82, 0.05), vec3f(0.04, 0.04, 0.04), stripe), band);
    return sat3(col);
  } else if (variant < 1.5) {
    var col = mix(vec3f(0.06, 0.06, 0.07), vec3f(0.11, 0.11, 0.12), fbm(uv.x * 18.0 + seed, uv.y * 18.0, 5.0) * 0.5 + 0.5);
    let head = line_near(length((uv - vec2f(0.5, 0.28)) * vec2f(1.0, 1.0)) - 0.10, 0.012);
    let body = line_near(length((uv - vec2f(0.5, 0.62)) * vec2f(0.7, 1.4)) - 0.22, 0.012);
    let chalk = sat(head + body) * (0.6 + 0.4 * speckle(px, 2.0, seed, 0.4));
    col = mix(col, vec3f(0.86, 0.88, 0.84), chalk);
    return sat3(col);
  }
  var col = mix(vec3f(0.07, 0.07, 0.08), vec3f(0.12, 0.12, 0.13), fbm(uv.x * 16.0 + seed, uv.y * 16.0, 4.0) * 0.5 + 0.5);
  let tent = (1.0 - smoothstep(0.0, 0.02, abs(uv.x - 0.5) - (uv.y - 0.30) * 0.6)) * smoothstep(0.30, 0.32, uv.y) * smoothstep(0.82, 0.80, uv.y);
  col = mix(col, vec3f(0.96, 0.80, 0.06), tent);
  let num = (1.0 - smoothstep(0.0, 0.015, abs(uv.x - 0.5) - 0.04)) * smoothstep(0.55, 0.57, uv.y) * smoothstep(0.72, 0.70, uv.y);
  col = mix(col, vec3f(0.1, 0.05, 0.0), num);
  return sat3(col);
}

fn refuse(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // Dumpster / street squalor. 0 corrugated cardboard, 1 wet trash w/ wrapper
  // glints, 2 crushed can.
  if (variant < 0.5) {
    let corr = sin(uv.x * 70.0) * 0.5 + 0.5;
    var col = mix(vec3f(0.40, 0.28, 0.16), vec3f(0.66, 0.48, 0.28), fbm(uv.x * 6.0 + seed, uv.y * 6.0, 4.0) * 0.5 + 0.5);
    col = col * (0.85 + 0.15 * corr);
    let tape = smoothstep(0.44, 0.46, uv.y) * smoothstep(0.58, 0.56, uv.y);
    col = mix(col, vec3f(0.63, 0.58, 0.45), tape * 0.6);
    col = mix(col, vec3f(0.30, 0.22, 0.12), blotch(uv, vec2f(0.7, 0.7), 0.18, vec2f(1.1, 0.9), seed) * 0.5);
    return sat3(col - vec3f(0.08, 0.08, 0.08) * speckle(px, 3.0, seed, 0.92));
  } else if (variant < 1.5) {
    var col = mix(vec3f(0.04, 0.05, 0.04), vec3f(0.12, 0.14, 0.10), fbm(uv.x * 10.0 + seed, uv.y * 10.0, 5.0) * 0.5 + 0.5);
    let glint = speckle(px, 4.0, seed, 0.93);
    let wrap = rand(floor(px / 5.0) + vec2f(seed, seed * 2.0));
    let wcol = vec3f(0.5 + 0.5 * sin(wrap * 30.0), 0.5 + 0.5 * sin(wrap * 30.0 + 2.0), 0.5 + 0.5 * sin(wrap * 30.0 + 4.0));
    col = mix(col, wcol, glint * 0.5);
    col = col + vec3f(0.2, 0.2, 0.2) * speckle(px, 2.0, seed + 3.0, 0.96);
    return sat3(col);
  }
  var col = mix(vec3f(0.30, 0.32, 0.34), vec3f(0.62, 0.64, 0.66), fbm(uv.x * 8.0 + seed, uv.y * 14.0, 4.0) * 0.5 + 0.5);
  col = col - vec3f(0.2, 0.2, 0.2) * line_near(snoise(uv.x * 6.0 + seed, uv.y * 4.0 - seed), 0.05);
  let label = smoothstep(0.40, 0.42, uv.y) * smoothstep(0.60, 0.58, uv.y);
  col = mix(col, vec3f(0.85, 0.15, 0.18), label * 0.7);
  return sat3(col + vec3f(0.15, 0.15, 0.15) * line_near(sin(uv.x * 40.0), 0.1));
}

fn corkboard(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // The "AI playing Clue" investigation board. 0 bare cork, 1 taped photos,
  // 2 photos + red string + pins (the Case visualised).
  var col = mix(vec3f(0.52, 0.38, 0.20), vec3f(0.72, 0.56, 0.34), fbm(uv.x * 20.0 + seed, uv.y * 20.0, 5.0) * 0.5 + 0.5);
  col = col - vec3f(0.10, 0.10, 0.10) * speckle(px, 1.8, seed, 0.55);
  if (variant < 0.5) { return sat3(col); }
  let p1 = step(0.10, uv.x) * step(uv.x, 0.34) * step(0.18, uv.y) * step(uv.y, 0.46);
  let p2 = step(0.60, uv.x) * step(uv.x, 0.86) * step(0.30, uv.y) * step(uv.y, 0.60);
  let p3 = step(0.34, uv.x) * step(uv.x, 0.58) * step(0.58, uv.y) * step(uv.y, 0.84);
  let photo = sat(p1 + p2 + p3);
  let pimg = fbm(uv.x * 12.0 + seed, uv.y * 12.0, 4.0) * 0.5 + 0.5;
  col = mix(col, mix(vec3f(0.20, 0.22, 0.26), vec3f(0.62, 0.64, 0.68), pimg), photo * 0.92);
  if (variant >= 1.5) {
    let s1 = segment_mark(uv, vec2f(0.22, 0.32), vec2f(0.73, 0.45), 0.006);
    let s2 = segment_mark(uv, vec2f(0.73, 0.45), vec2f(0.46, 0.71), 0.006);
    let s3 = segment_mark(uv, vec2f(0.46, 0.71), vec2f(0.22, 0.32), 0.006);
    col = mix(col, vec3f(0.86, 0.06, 0.10), sat(s1 + s2 + s3) * 0.85);
    let pins = sat(dot_mark(uv, vec2f(0.22, 0.32), 0.02) + dot_mark(uv, vec2f(0.73, 0.45), 0.02) + dot_mark(uv, vec2f(0.46, 0.71), 0.02));
    col = mix(col, vec3f(0.95, 0.2, 0.2), pins);
  }
  return sat3(col);
}

fn substance_spill(uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  // The high system's substance, the most-Spun prop. 0 scattered pills,
  // 1 chopped lines on a mirror + razor, 2 residue smear.
  if (variant < 0.5) {
    var col = mix(vec3f(0.10, 0.10, 0.12), vec3f(0.16, 0.16, 0.18), fbm(uv.x * 12.0 + seed, uv.y * 12.0, 4.0) * 0.5 + 0.5);
    for (var i = 0; i < 7; i = i + 1) {
      let fi = f32(i);
      let c = vec2f(rand(vec2f(fi, seed)), rand(vec2f(fi + 9.0, seed)));
      let pill = 1.0 - smoothstep(0.04, 0.05, length((uv - c) * vec2f(1.0, 1.8)));
      let cap_half = step(uv.x, c.x);
      let pc = mix(vec3f(0.9, 0.2, 0.2), vec3f(0.95, 0.95, 0.98), cap_half);
      col = mix(col, pc, pill);
      col = col + vec3f(0.4, 0.4, 0.4) * (1.0 - smoothstep(0.0, 0.02, length((uv - c + vec2f(0.0, 0.01)) * vec2f(1.0, 1.8)))) * pill;
    }
    return sat3(col);
  } else if (variant < 1.5) {
    var col = mix(vec3f(0.06, 0.07, 0.10), vec3f(0.14, 0.16, 0.22), uv.y);
    col = col + vec3f(0.10, 0.10, 0.10) * line_near(uv.x - 0.5, 0.3);
    let l1 = segment_mark(uv, vec2f(0.20, 0.40), vec2f(0.62, 0.40), 0.018);
    let l2 = segment_mark(uv, vec2f(0.24, 0.55), vec2f(0.70, 0.55), 0.016);
    let l3 = segment_mark(uv, vec2f(0.30, 0.70), vec2f(0.66, 0.70), 0.014);
    let lines = sat(l1 + l2 + l3);
    col = mix(col, vec3f(0.96, 0.97, 0.99), lines * (0.7 + 0.3 * speckle(px, 1.4, seed, 0.4)));
    let blade = step(0.72, uv.x) * step(uv.x, 0.90) * step(0.30, uv.y) * step(uv.y, 0.78);
    col = mix(col, vec3f(0.75, 0.78, 0.82), blade * 0.8);
    return sat3(col);
  }
  var col = mix(vec3f(0.08, 0.08, 0.10), vec3f(0.14, 0.14, 0.16), fbm(uv.x * 10.0 + seed, uv.y * 10.0, 4.0) * 0.5 + 0.5);
  let smear = blotch(uv, vec2f(0.5, 0.5), 0.28, vec2f(1.6, 0.6), seed) * (fbm(uv.x * 8.0 + seed, uv.y * 4.0, 4.0) * 0.5 + 0.5);
  col = mix(col, vec3f(0.80, 0.80, 0.84), smear * 0.6);
  col = col + vec3f(0.06, 0.06, 0.06) * speckle(px, 1.6, seed, 0.7);
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
  if (board > 4.5) {
    // Board F contraband — Spun squalor grade: shadow-mold in the lows, lint in
    // the speckle. Mirrors Board B's condemned grime.
    out_col = mix(out_col, vec3f(0.020, 0.022, 0.018), smoothstep(0.60 - q * 0.05, 0.94, coarse) * (0.12 + q * 0.10));
    out_col = mix(out_col, vec3f(0.10, 0.09, 0.07), fleck * (0.08 + q * 0.06));
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

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let material = i32(D[0] + 0.5);
  let variant = D[1];
  let seed = D[2];
  let quality = D[3];
  let board = D[4];
  var uv = in.uv;
  if (quality < 0.5) {
    uv = (floor(in.uv * 32.0) + vec2f(0.5, 0.5)) / 32.0;
  } else if (quality < 1.5) {
    uv = (floor(in.uv * 64.0) + vec2f(0.5, 0.5)) / 64.0;
  }
  let px = uv * vec2f(U.size_w, U.size_h);
  var col = vec3f(0.0, 0.0, 0.0);

  if (board < 0.5) {
    if (material == 0) { col = road(uv, px, variant, seed); }
    else if (material == 1) { col = concrete(uv, px, variant, seed); }
    else if (material == 2) { col = brick(uv, px, variant, seed); }
    else if (material == 3) { col = sand(uv, px, variant, seed); }
    else if (material == 4) { col = water(uv, px, variant, seed); }
    else if (material == 5) { col = grass(uv, px, variant, seed); }
    else { col = wood(uv, px, variant, seed); }
  } else if (board < 1.5) {
    if (material == 0) { col = mold_wall(uv, px, variant, seed); }
    else if (material == 1) { col = peel_paint(uv, px, variant, seed); }
    else if (material == 2) { col = linoleum(uv, px, variant, seed); }
    else if (material == 3) { col = bath_tile(uv, px, variant, seed); }
    else if (material == 4) { col = mildew_brick(uv, px, variant, seed); }
    else if (material == 5) { col = rot_siding(uv, px, variant, seed); }
    else { col = rust_sheet(uv, px, variant, seed); }
  } else if (board < 2.5) {
    if (material == 0) { col = blade_steel(uv, px, variant, seed); }
    else if (material == 1) { col = gunmetal(uv, px, variant, seed); }
    else if (material == 2) { col = grip_polymer(uv, px, variant, seed); }
    else if (material == 3) { col = leather(uv, px, variant, seed); }
    else if (material == 4) { col = denim(uv, px, variant, seed); }
    else if (material == 5) { col = fabric_fill(uv, px, variant, seed); }
    else { col = skin_fill(uv, px, variant, seed); }
  } else if (board < 3.5) {
    if (material == 0) { col = peel_wallpaper_vice(uv, px, variant, seed); }
    else if (material == 1) { col = motel_carpet(uv, px, variant, seed); }
    else if (material == 2) { col = rotten_rug(uv, px, variant, seed); }
    else if (material == 3) { col = neon_stucco(uv, px, variant, seed); }
    else if (material == 4) { col = pool_tile_vice(uv, px, variant, seed); }
    else if (material == 5) { col = booth_vinyl(uv, px, variant, seed); }
    else if (material == 6) { col = drop_ceiling(uv, px, variant, seed); }
    else { col = pdx_carpet(uv, px, variant, seed); }
  } else if (board < 4.5) {
    if (material == 0) { col = stucco_facade(uv, px, variant, seed); }
    else if (material == 1) { col = neon_tube(uv, px, variant, seed); }
    else if (material == 2) { col = sunset_grad(uv, px, variant, seed); }
    else if (material == 3) { col = wet_asphalt(uv, px, variant, seed); }
    else if (material == 4) { col = car_paint(uv, px, variant, seed); }
    else if (material == 5) { col = crt_screen(uv, px, variant, seed); }
    else { col = palm_canopy(uv, px, variant, seed); }
  } else {
    if (material == 0) { col = cash_stack(uv, px, variant, seed); }
    else if (material == 1) { col = product_baggie(uv, px, variant, seed); }
    else if (material == 2) { col = blood_pool(uv, px, variant, seed); }
    else if (material == 3) { col = evidence_tape(uv, px, variant, seed); }
    else if (material == 4) { col = refuse(uv, px, variant, seed); }
    else if (material == 5) { col = corkboard(uv, px, variant, seed); }
    else { col = substance_spill(uv, px, variant, seed); }
  }

  let vignette = 1.0 - smoothstep(0.20, 0.88, length(uv - vec2f(0.5, 0.5)));
  col = quality_pass(col, uv, px, seed, quality, board);
  col = col * (0.82 + vignette * 0.20);
  return vec4f(sat3(col), 1.0);
}
`;

function fillData(materialId: number, variant: number, quality: QualityGrade, board: BoardId): number[] {
  const seed = board === 0
    ? materialId * 17.0 + variant * 5.0 + 3.0
    : board === 1
      ? materialId * 23.0 + variant * 11.0 + 41.0
      : board === 2
        ? materialId * 29.0 + variant * 13.0 + 89.0
        : board === 3
          ? materialId * 31.0 + variant * 17.0 + 131.0
          : board === 4
            ? materialId * 37.0 + variant * 19.0 + 181.0
            : materialId * 41.0 + variant * 23.0 + 229.0;
  return [materialId, variant, seed, quality, board];
}

function swatchId(prefix: string, materialId: number, variant: number): string {
  const n = materialId * VARIANTS.length + variant + 1;
  return prefix + (n < 10 ? `0${n}` : `${n}`);
}

function Swatch({ data, idLabel }: { data: number[]; idLabel: string }) {
  return (
    <Box
      style={{
        position: 'relative',
        width: SWATCH,
        height: SWATCH,
        backgroundColor: '#05070a',
        borderWidth: 1,
        borderColor: '#223042',
        overflow: 'hidden',
      }}
    >
      <Effect shader={FILL_SHADER} data={data} style={{ position: 'absolute', left: 0, top: 0, width: SWATCH, height: SWATCH }} />
      <Box style={{ position: 'absolute', left: 6, top: 6, paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2, backgroundColor: '#05070acc', borderWidth: 1, borderColor: '#d8e2ef55' }}>
        <Text style={{ fontSize: 10, color: '#f4f7fb', fontFamily: 'monospace', fontWeight: '800' }}>{idLabel}</Text>
      </Box>
    </Box>
  );
}

function MaterialColumn({ material, quality }: { material: typeof MATERIALS[number]; quality: QualityGrade }) {
  return (
    <Col style={{ width: SWATCH, gap: 10 }}>
      <Text style={{ fontSize: 13, color: '#d8e2ef', fontWeight: '700' }}>{material.name}</Text>
      {VARIANTS.map((variant) => (
        <Swatch key={`${material.id}-${variant}`} data={fillData(material.id, variant, quality, 0)} idLabel={swatchId('A', material.id, variant)} />
      ))}
    </Col>
  );
}

function GrungeColumn({ material, quality }: { material: typeof GRUNGE_MATERIALS[number]; quality: QualityGrade }) {
  return (
    <Col style={{ width: SWATCH, gap: 10 }}>
      <Text style={{ fontSize: 13, color: '#d8e2ef', fontWeight: '700' }}>{material.name}</Text>
      {VARIANTS.map((variant) => (
        <Swatch key={`g-${material.id}-${variant}`} data={fillData(material.id, variant, quality, 1)} idLabel={swatchId('B', material.id, variant)} />
      ))}
    </Col>
  );
}

function PropColumn({ material, quality }: { material: typeof PROP_MATERIALS[number]; quality: QualityGrade }) {
  return (
    <Col style={{ width: SWATCH, gap: 10 }}>
      <Text style={{ fontSize: 13, color: '#d8e2ef', fontWeight: '700' }}>{material.name}</Text>
      {VARIANTS.map((variant) => (
        <Swatch key={`p-${material.id}-${variant}`} data={fillData(material.id, variant, quality, 2)} idLabel={swatchId('C', material.id, variant)} />
      ))}
    </Col>
  );
}

function ViceColumn({ material, quality }: { material: typeof VICE_MATERIALS[number]; quality: QualityGrade }) {
  return (
    <Col style={{ width: SWATCH, gap: 10 }}>
      <Text style={{ fontSize: 13, color: '#d8e2ef', fontWeight: '700' }}>{material.name}</Text>
      {VARIANTS.map((variant) => (
        <Swatch key={`v-${material.id}-${variant}`} data={fillData(material.id, variant, quality, 3)} idLabel={swatchId('D', material.id, variant)} />
      ))}
    </Col>
  );
}

function SurfaceColumn({ material, quality }: { material: typeof SURFACE_MATERIALS[number]; quality: QualityGrade }) {
  return (
    <Col style={{ width: SWATCH, gap: 10 }}>
      <Text style={{ fontSize: 13, color: '#d8e2ef', fontWeight: '700' }}>{material.name}</Text>
      {VARIANTS.map((variant) => (
        <Swatch key={`e-${material.id}-${variant}`} data={fillData(material.id, variant, quality, 4)} idLabel={swatchId('E', material.id, variant)} />
      ))}
    </Col>
  );
}

function ContraColumn({ material, quality }: { material: typeof CONTRA_MATERIALS[number]; quality: QualityGrade }) {
  return (
    <Col style={{ width: SWATCH, gap: 10 }}>
      <Text style={{ fontSize: 13, color: '#d8e2ef', fontWeight: '700' }}>{material.name}</Text>
      {VARIANTS.map((variant) => (
        <Swatch key={`f-${material.id}-${variant}`} data={fillData(material.id, variant, quality, 5)} idLabel={swatchId('F', material.id, variant)} />
      ))}
    </Col>
  );
}

function BoardHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <Row style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
      <Col style={{ gap: 4 }}>
        <Text style={{ fontSize: 29, color: '#f4f7fb', fontWeight: '800' }}>{title}</Text>
        <Text style={{ fontSize: 13, color: '#8fa3bb' }}>{subtitle}</Text>
      </Col>
    </Row>
  );
}

function QualityToggle({ quality, onChange }: { quality: QualityGrade; onChange: (quality: QualityGrade) => void }) {
  return (
    <Row style={{ gap: 8, alignItems: 'center' }}>
      <Text style={{ fontSize: 12, color: '#8fa3bb', fontWeight: '700' }}>Quality</Text>
      <Row style={{ gap: 2, backgroundColor: '#101820', borderWidth: 1, borderColor: '#223042', padding: 3 }}>
        {QUALITY_GRADES.map((grade) => {
          const active = quality === grade.id;
          return (
            <Pressable
              key={grade.id}
              onPress={() => onChange(grade.id)}
              style={{
                width: 68,
                height: 34,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: active ? '#d8e2ef' : '#101820',
                borderWidth: 1,
                borderColor: active ? '#d8e2ef' : '#1a2533',
              }}
            >
              <Text style={{ fontSize: 12, color: active ? '#071018' : '#b8c6d8', fontWeight: '800' }}>{grade.label}</Text>
            </Pressable>
          );
        })}
      </Row>
      <Text style={{ fontSize: 12, color: '#65758a' }}>{QUALITY_GRADES[quality].note}</Text>
    </Row>
  );
}

export default function EffectFills() {
  const [quality, setQuality] = useState<QualityGrade>(3);

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#070b10' }}>
      <Row style={{ paddingLeft: 26, paddingRight: 26, paddingTop: 18, paddingBottom: 12, alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: '#162232' }}>
        <Col style={{ gap: 3 }}>
          <Text style={{ fontSize: 18, color: '#f4f7fb', fontWeight: '800' }}>Effect Fill Lab</Text>
          <Text style={{ fontSize: 12, color: '#65758a' }}>runtime detail grade feeds every swatch; IDs stay stable across grades</Text>
        </Col>
        <QualityToggle quality={quality} onChange={setQuality} />
      </Row>

      <ScrollView showScrollbar style={{ flexGrow: 1, minHeight: 0, width: '100%' }}>
        <Col style={{ padding: 26, gap: 34 }}>
          <Col style={{ gap: 18 }}>
            <BoardHeader title="Board A / Environment" subtitle="A01-A21: road, concrete, brick, sand, water, grass, wood" />
            <Row style={{ gap: 18, alignItems: 'flex-start' }}>
              {MATERIALS.map((material) => (
                <MaterialColumn key={material.id} material={material} quality={quality} />
              ))}
            </Row>
          </Col>

          <Col style={{ gap: 18 }}>
            <BoardHeader title="Board B / Condemned" subtitle="B01-B21: mold, water damage, rot, rust, cracked interior and exterior tiles" />
            <Row style={{ gap: 18, alignItems: 'flex-start' }}>
              {GRUNGE_MATERIALS.map((material) => (
                <GrungeColumn key={material.id} material={material} quality={quality} />
              ))}
            </Row>
          </Col>

          <Col style={{ gap: 18 }}>
            <BoardHeader title="Board C / Props and Wearables" subtitle="C01-C21: blade, gunmetal, grip, leather, denim, fabric, skin fills" />
            <Row style={{ gap: 18, alignItems: 'flex-start' }}>
              {PROP_MATERIALS.map((material) => (
                <PropColumn key={material.id} material={material} quality={quality} />
              ))}
            </Row>
          </Col>

          <Col style={{ gap: 18 }}>
            <BoardHeader title="Board D / Neon Rot" subtitle="D01-D24: wallpaper, carpets, rugs, stucco, tile, vinyl, ceiling stains, PDX carpet" />
            <Row style={{ gap: 8, alignItems: 'flex-start' }}>
              {VICE_MATERIALS.map((material) => (
                <ViceColumn key={material.id} material={material} quality={quality} />
              ))}
            </Row>
          </Col>

          <Col style={{ gap: 18 }}>
            <BoardHeader title="Board E / Neon Surface — Claude" subtitle="E01-E21: stucco facade, neon tube, sunset sky, wet asphalt, car paint, CRT screen, palm canopy — the Drive/Miami dream pole for scape3d" />
            <Row style={{ gap: 18, alignItems: 'flex-start' }}>
              {SURFACE_MATERIALS.map((material) => (
                <SurfaceColumn key={material.id} material={material} quality={quality} />
              ))}
            </Row>
          </Col>

          <Col style={{ gap: 18 }}>
            <BoardHeader title="Board F / Contraband & Consequence — Claude" subtitle="F01-F21: cash stack, product baggie, blood pool, evidence, refuse, corkboard, substance — the Spun squalor game-objects" />
            <Row style={{ gap: 18, alignItems: 'flex-start' }}>
              {CONTRA_MATERIALS.map((material) => (
                <ContraColumn key={material.id} material={material} quality={quality} />
              ))}
            </Row>
          </Col>
        </Col>
      </ScrollView>
    </Box>
  );
}
