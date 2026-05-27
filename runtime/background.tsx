/**
 * Background — themed full-surface shader backgrounds.
 *
 * Renders a GPU-shaded background that re-templates its WGSL with current
 * theme token values, so every variant automatically adopts whatever palette
 * is active. Children are layered on top via normal flex layout.
 *
 * Variants share the same visual contract:
 *   - cockpit-warm-style background wash
 *   - cursor halo: dots/lines/clouds reveal under the mouse
 *   - autonomous idle motion (so the surface never looks frozen)
 *   - 4×4 Bayer ordered dither for a consistent bitmap "grain"
 *
 * Tokens consulted (with fallbacks so it works across theme systems):
 *   bg     ← bg
 *   bg2    ← bg2 / bgElevated / bgAlt
 *   cool   ← blue / info / primary
 *   body   ← accent
 *   bright ← warn / warning
 *   hot    ← accentHot / error
 */

import * as React from 'react';
import { Box, Effect } from './primitives';
import { useThemeColors, type ThemeColors } from './classifier';

export type BackgroundType = 'dots' | 'scan' | 'ember' | 'grid';
export type BackgroundMode = 'cursor' | 'static';

interface BackgroundProps {
  type?: BackgroundType;
  /** 'cursor' (default) — shader follows the mouse. 'static' — no cursor
   *  reveal, only the autonomous idle motion plays. */
  mode?: BackgroundMode;
  /** Pixel radius for shader-side rounded-rect alpha mask. The host's CSS
   *  `borderRadius` + `overflow: hidden` doesn't clip GPU texture quads, so
   *  pass the same radius here and the shader fades alpha to 0 outside the
   *  rounded perimeter. 0 (default) = sharp rectangle. */
  cornerRadius?: number;
  children?: React.ReactNode;
}

// ── Token resolution ─────────────────────────────────────────────────────

function pick(colors: ThemeColors, ...keys: string[]): string {
  const map = colors as unknown as Record<string, string>;
  for (const k of keys) {
    const v = map[k];
    if (v) return v;
  }
  return '#888888';
}

function parseColor(input: string): [number, number, number] {
  const s = input.trim();
  if (s.startsWith('#')) {
    let hex = s.slice(1);
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    return [r, g, b];
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1].split(',').map(p => parseFloat(p.trim()));
    return [parts[0] / 255, parts[1] / 255, parts[2] / 255];
  }
  return [0.5, 0.5, 0.5];
}

function vec3(input: string): string {
  const [r, g, b] = parseColor(input);
  return `vec3f(${r.toFixed(4)}, ${g.toFixed(4)}, ${b.toFixed(4)})`;
}

interface PaletteVec3 {
  bg: string;
  bg2: string;
  cool: string;
  body: string;
  bright: string;
  hot: string;
  bgHex: string;
  /** Inlined as the WGSL expression for `mouse_inside`. 'U.mouse_inside' for
   *  cursor mode (real value), '0.0' for static mode (always-idle). */
  mouseInside: string;
  /** WGSL block that produces the final return statement. Includes a rounded-
   *  rect alpha mask when cornerRadius > 0 so the texture quad reads as
   *  rounded; otherwise a plain `return vec4f(col, 1.0)`. */
  closer: string;
}

function roundedReturn(p: PaletteVec3): string {
  return p.closer;
}

function buildClose(cornerRadius: number): string {
  if (cornerRadius <= 0) return 'return vec4f(col, 1.0);';
  const R = cornerRadius.toFixed(1);
  return `
  // Cap requested radius to half the short edge so pill-radii (999) don't
  // overflow the clamp() (lo > hi → bogus distance → entire surface masked).
  let _R = min(${R}, min(U.size_w, U.size_h) * 0.5);
  let _cx = clamp(x, _R, U.size_w - _R);
  let _cy = clamp(y, _R, U.size_h - _R);
  let _dx = x - _cx;
  let _dy = y - _cy;
  let _d = sqrt(_dx * _dx + _dy * _dy);
  let _a = 1.0 - smoothstep(_R - 1.0, _R, _d);
  return vec4f(col * _a, _a);
  `;
}

function paletteFrom(colors: ThemeColors, mode: BackgroundMode, cornerRadius: number): PaletteVec3 {
  const bgHex     = pick(colors, 'bg');
  const bg2Hex    = pick(colors, 'bg2', 'bgElevated', 'bgAlt', 'bg');
  const coolHex   = pick(colors, 'blue', 'info', 'primary', 'accent');
  const bodyHex   = pick(colors, 'accent', 'primary');
  const brightHex = pick(colors, 'warn', 'warning', 'accent');
  const hotHex    = pick(colors, 'accentHot', 'error', 'flag', 'accent');
  return {
    bg:     vec3(bgHex),
    bg2:    vec3(bg2Hex),
    cool:   vec3(coolHex),
    body:   vec3(bodyHex),
    bright: vec3(brightHex),
    hot:    vec3(hotHex),
    bgHex,
    mouseInside: mode === 'static' ? '0.0' : 'U.mouse_inside',
    closer: buildClose(cornerRadius),
  };
}

// ── Shared shader fragments ──────────────────────────────────────────────

const BAYER_DITHER = `
  let bayer = array<f32, 16>(
     0.0,  8.0,  2.0, 10.0,
    12.0,  4.0, 14.0,  6.0,
     3.0, 11.0,  1.0,  9.0,
    15.0,  7.0, 13.0,  5.0
  );
  let ix = i32(floor(x)) & 3;
  let iy = i32(floor(y)) & 3;
  let threshold = (bayer[iy * 4 + ix] + 0.5) / 16.0 - 0.5;
  let levels = 32.0;
  let dithered = floor(col * levels + threshold * 0.9) / levels;
  col = clamp(dithered, vec3f(0.0), vec3f(1.0));
`;

// ── Variant shaders ──────────────────────────────────────────────────────

function dotsShader(p: PaletteVec3): string {
  return `
fn layer(x: f32, y: f32, cell: f32, ox: f32, oy: f32, radius: f32, t: f32) -> f32 {
  let sx = x + ox; let sy = y + oy;
  let cx = floor(sx / cell); let cy = floor(sy / cell);
  let lx = sx - cx * cell;   let ly = sy - cy * cell;
  let center = cell * 0.5;
  let dx = lx - center; let dy = ly - center;
  let dist = sqrt(dx * dx + dy * dy);
  let field = fbm(cx * 0.18 + t * 0.05, cy * 0.22 - t * 0.03, 4.0);
  let brightness = clamp(field * 0.6 + 0.5, 0.0, 1.0);
  let edge = smoothstep(radius, radius - 1.5, dist);
  return edge * brightness;
}

fn lightAt(x: f32, y: f32, lx: f32, ly: f32, sigma: f32) -> f32 {
  let dx = x - lx; let dy = y - ly;
  return exp(-(dx * dx + dy * dy) / (2.0 * sigma * sigma));
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let x = in.uv.x * U.size_w;
  let y = in.uv.y * U.size_h;
  let t = U.time;
  let mxN = ((U.mouse_x / U.size_w) * 2.0 - 1.0) * ${p.mouseInside};
  let myN = ((U.mouse_y / U.size_h) * 2.0 - 1.0) * ${p.mouseInside};
  let idle = 1.0 - ${p.mouseInside};

  var col = mix(${p.bg}, ${p.bg2}, in.uv.y);

  // Glow sigma scales with the surface short-edge so the same shader reads
  // correctly on a 1280×800 page bg AND on a 460×80 list-item card.
  let SIGMA = clamp(min(U.size_w, U.size_h) * 0.30, 25.0, 140.0);

  let cursorPulse = 0.85 + 0.15 * sin(t * 2.4);
  let cursorGlow = lightAt(x, y, U.mouse_x, U.mouse_y, SIGMA) * ${p.mouseInside} * cursorPulse;
  let g1x = U.size_w * (0.5 + 0.36 * sin(t * 0.27));
  let g1y = U.size_h * (0.5 + 0.30 * cos(t * 0.21));
  let g2x = U.size_w * (0.5 + 0.40 * cos(t * 0.19 + 1.7));
  let g2y = U.size_h * (0.5 + 0.32 * sin(t * 0.23 + 2.3));
  let g3x = U.size_w * (0.5 + 0.30 * sin(t * 0.33 + 4.1));
  let g3y = U.size_h * (0.5 + 0.28 * cos(t * 0.29 + 5.0));
  let ghostGlow = (lightAt(x, y, g1x, g1y, SIGMA * 1.15)
                 + lightAt(x, y, g2x, g2y, SIGMA)
                 + lightAt(x, y, g3x, g3y, SIGMA * 1.25)) * 0.55 * idle;
  let glow = cursorGlow + ghostGlow;

  let driftX = sin(t * 0.17) * 0.30 + cos(t * 0.09) * 0.22;
  let driftY = cos(t * 0.13) * 0.28 + sin(t * 0.11) * 0.24;
  let driftMix = 0.30 + 0.70 * idle;
  let pX = mxN + driftX * driftMix;
  let pY = myN + driftY * driftMix;

  let back  = layer(x, y, 26.0, pX *  6.0, pY *  4.0, 1.8, t);
  let mid   = layer(x, y, 18.0, pX * 22.0, pY * 14.0, 2.2, t);
  let front = layer(x, y, 12.0, pX * 60.0, pY * 40.0, 2.8, t);

  let reveal = glow * 2.6;
  col = col + ${p.cool}   * back  * 0.45 * reveal;
  col = col + ${p.body}   * mid   * 0.70 * reveal;
  col = col + ${p.bright} * front * 1.00 * reveal;
  col = col + ${p.hot}    * glow  * 0.15;

${BAYER_DITHER}
  ${roundedReturn(p)}
}
`;
}

function scanShader(p: PaletteVec3): string {
  return `
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let x = in.uv.x * U.size_w;
  let y = in.uv.y * U.size_h;
  let t = U.time;
  var col = mix(${p.bg}, ${p.bg2}, in.uv.y);

  let dxM = x - U.mouse_x;
  let dyM = y - U.mouse_y;
  let r2 = dxM * dxM + dyM * dyM;
  let dist = sqrt(r2);
  let cursorPulse = 0.85 + 0.15 * sin(t * 2.4);
  let SIGMA = clamp(min(U.size_w, U.size_h) * 0.30, 25.0, 140.0);
  let heat = exp(-r2 / (2.0 * SIGMA * SIGMA)) * ${p.mouseInside} * cursorPulse;
  let idle = 1.0 - ${p.mouseInside};

  let ripple = sin(dist * 0.05 - t * 5.0) * heat * 18.0;
  let phase = (y - t * 22.0 + ripple) * 0.18;
  let line = pow(0.5 + 0.5 * sin(phase), 6.0);
  let colShimmer = 0.5 + 0.5 * sin(x * 0.03 + t * 0.7);
  let lineMix = line * (0.6 + 0.4 * colShimmer);

  let lineCol = mix(${p.bright}, ${p.hot}, clamp(heat * 2.0, 0.0, 1.0));
  col = col + lineCol * lineMix * (0.45 + heat * 1.8);

  let bandY = U.size_h * (0.5 + 0.35 * sin(t * 0.13));
  let band = exp(-pow((y - bandY) / 80.0, 2.0));
  col = col + ${p.bright} * band * 0.12 * idle;

  col = col + ${p.hot} * heat * 0.13;

${BAYER_DITHER}
  ${roundedReturn(p)}
}
`;
}

function emberShader(p: PaletteVec3): string {
  return `
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let x = in.uv.x * U.size_w;
  let y = in.uv.y * U.size_h;
  let t = U.time;
  var col = mix(${p.bg}, ${p.bg2}, in.uv.y);

  let dxM = x - U.mouse_x;
  let dyM = y - U.mouse_y;
  let r2 = dxM * dxM + dyM * dyM;
  let pulse = 0.85 + 0.15 * sin(t * 2.4);
  let SIGMA = clamp(min(U.size_w, U.size_h) * 0.30, 25.0, 140.0);
  let heat = exp(-r2 / (2.0 * SIGMA * SIGMA)) * ${p.mouseInside} * pulse;
  let idle = 1.0 - ${p.mouseInside};

  let nx = x * 0.005 + t * 0.020;
  let ny = y * 0.005 - t * 0.015;
  let cloud = fbm(nx, ny, 5.0);
  let intensity = clamp(cloud * 0.5 + 0.5, 0.0, 1.0);
  let bandCount = 6.0;
  let banded = floor(intensity * bandCount) / bandCount;

  let emberCol = mix(${p.body}, ${p.bright}, banded);
  let vis = banded * (heat * 2.6 + 0.18 * idle + 0.06);
  col = col + emberCol * vis;

  col = col + ${p.hot} * heat * 0.14;

${BAYER_DITHER}
  ${roundedReturn(p)}
}
`;
}

function gridShader(p: PaletteVec3): string {
  return `
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let x = in.uv.x * U.size_w;
  let y = in.uv.y * U.size_h;
  let t = U.time;
  var col = mix(${p.bg}, ${p.bg2}, in.uv.y);

  let dxM = x - U.mouse_x;
  let dyM = y - U.mouse_y;
  let r2 = dxM * dxM + dyM * dyM;
  let pulse = 0.85 + 0.15 * sin(t * 2.4);
  let SIGMA = clamp(min(U.size_w, U.size_h) * 0.30, 25.0, 140.0);
  let heat = exp(-r2 / (2.0 * SIGMA * SIGMA)) * ${p.mouseInside} * pulse;
  let idle = 1.0 - ${p.mouseInside};

  let cell = 36.0;
  let gx = abs(fract(x / cell) - 0.5) * cell;
  let gy = abs(fract(y / cell) - 0.5) * cell;
  let lineDist = min(gx, gy);
  let lineMask = smoothstep(1.2, 0.0, lineDist);
  let intersection = step(gx, 1.6) * step(gy, 1.6);

  let cx = U.size_w * 0.5;
  let cy = U.size_h * 0.5;
  let dCenter = sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
  let wave = pow(0.5 + 0.5 * sin(dCenter * 0.018 - t * 1.8), 5.0);

  let base       = lineMask * 0.16;
  let cursorLine = lineMask * heat * 2.6;
  let idleWave   = lineMask * wave * (0.20 + 0.45 * idle);

  col = col + ${p.bright} * (base + idleWave);
  col = col + ${p.hot}    * cursorLine;
  col = col + ${p.hot}    * intersection * (heat * 1.4 + wave * 0.7 * idle);
  col = col + ${p.hot}    * heat * 0.13;

${BAYER_DITHER}
  ${roundedReturn(p)}
}
`;
}

function buildShader(type: BackgroundType, p: PaletteVec3): string {
  switch (type) {
    case 'scan':  return scanShader(p);
    case 'ember': return emberShader(p);
    case 'grid':  return gridShader(p);
    case 'dots':
    default:      return dotsShader(p);
  }
}

// ── Component ────────────────────────────────────────────────────────────

export function Background({ type = 'dots', mode = 'cursor', cornerRadius = 0, children }: BackgroundProps) {
  const colors = useThemeColors();
  const palette = React.useMemo(() => paletteFrom(colors, mode, cornerRadius), [colors, mode, cornerRadius]);
  const shader = React.useMemo(() => buildShader(type, palette), [type, palette]);

  return (
    <Box style={{ position: 'relative', width: '100%', height: '100%', backgroundColor: palette.bgHex, overflow: 'hidden' }}>
      <Effect
        background
        shader={shader}
        style={{ position: 'absolute', width: '100%', height: '100%' }}
      />
      {children}
    </Box>
  );
}
