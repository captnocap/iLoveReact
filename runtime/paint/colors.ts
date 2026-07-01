// runtime/paint/colors.ts — dependency-free color math for the universal
// paint kit. Promoted from hmsc-int/editors/paint/colors.ts so every cart and
// tool shares ONE color vocabulary instead of re-deriving hex/HSV conversion.
// Pure functions, no React, no host — meaning-tests under tools/v8cli.

export type HsvColor = { h: number; s: number; v: number };

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
}

function normHue(h: number): number {
  if (!Number.isFinite(h)) return 0;
  return ((h % 1) + 1) % 1;
}

function byteHex(n: number): string {
  const b = Math.max(0, Math.min(255, Math.round(n)));
  return b.toString(16).padStart(2, '0');
}

export function normalizeHexColor(hex: string | null | undefined, fallback = '#ffffff'): string {
  const raw = String(hex ?? '').trim();
  const h = raw.startsWith('#') ? raw.slice(1) : raw;
  if (/^[0-9a-fA-F]{3}$/.test(h)) {
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(h)) return `#${h}`.toLowerCase();
  return fallback;
}

export function isHexColor(hex: string | null | undefined): boolean {
  const raw = String(hex ?? '').trim();
  const h = raw.startsWith('#') ? raw.slice(1) : raw;
  return /^[0-9a-fA-F]{3}$/.test(h) || /^[0-9a-fA-F]{6}$/.test(h);
}

export function isFullHexColor(hex: string | null | undefined): boolean {
  const raw = String(hex ?? '').trim();
  const h = raw.startsWith('#') ? raw.slice(1) : raw;
  return /^[0-9a-fA-F]{6}$/.test(h);
}

/** "#rrggbb" → [r,g,b] each 0..1. Falls back to white on malformed input. */
export function hexToRgb01(hex: string | null | undefined): [number, number, number] {
  const h = normalizeHexColor(hex);
  return [
    parseInt(h.slice(1, 3), 16) / 255,
    parseInt(h.slice(3, 5), 16) / 255,
    parseInt(h.slice(5, 7), 16) / 255,
  ];
}

export function rgb01ToHex(r: number, g: number, b: number): string {
  return `#${byteHex(clamp01(r) * 255)}${byteHex(clamp01(g) * 255)}${byteHex(clamp01(b) * 255)}`;
}

export function hexToHsv(hex: string | null | undefined): HsvColor {
  const [r, g, b] = hexToRgb01(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let hue = 0;
  if (d > 0) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue = normHue(hue / 6);
  }
  return { h: hue, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb01(hsv: HsvColor): [number, number, number] {
  const h = normHue(hsv.h);
  const s = clamp01(hsv.s);
  const v = clamp01(hsv.v);
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

export function hsvToHex(hsv: HsvColor): string {
  const [r, g, b] = hsvToRgb01(hsv);
  return rgb01ToHex(r, g, b);
}

// ---------------------------------------------------------------------------
// OKLCH — perceptually-even lightness/chroma/hue. Used by Color Studio's
// harmony/ramp/library lenses (hue rotation stays uniform in a way HSV can't
// give you). Same dependency-free contract as the HSV helpers above.

export type OklchColor = { l: number; c: number; h: number };

function srgbToLinear(v: number): number {
  const c = clamp01(v);
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(v: number): number {
  const c = Math.max(0, Math.min(1, v));
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function rgb01ToOklch(r: number, g: number, b: number): OklchColor {
  const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const okL = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const okA = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const okB = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  const c = Math.sqrt(okA * okA + okB * okB);
  const h = c < 0.0001 ? 0 : normDeg((Math.atan2(okB, okA) * 180) / Math.PI);
  return { l: okL, c, h };
}

export function oklchToRgb01(oklch: OklchColor): [number, number, number] {
  const hRad = (normDeg(oklch.h) * Math.PI) / 180;
  const okA = oklch.c * Math.cos(hRad);
  const okB = oklch.c * Math.sin(hRad);
  const l_ = oklch.l + 0.3963377774 * okA + 0.2158037573 * okB;
  const m_ = oklch.l - 0.1055613458 * okA - 0.0638541728 * okB;
  const s_ = oklch.l - 0.0894841775 * okA - 1.2914855480 * okB;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  const lr = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  return [clamp01(linearToSrgb(lr)), clamp01(linearToSrgb(lg)), clamp01(linearToSrgb(lb))];
}

export function oklchToHex(oklch: OklchColor): string {
  const [r, g, b] = oklchToRgb01(oklch);
  return rgb01ToHex(r, g, b);
}

export function hexToOklch(hex: string | null | undefined): OklchColor {
  const [r, g, b] = hexToRgb01(hex);
  return rgb01ToOklch(r, g, b);
}

function normDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export function rotateHue(oklch: OklchColor, degrees: number): OklchColor {
  return { l: oklch.l, c: oklch.c, h: normDeg(oklch.h + degrees) };
}

/** Shortest angular distance between two hues, in degrees [0, 180]. */
export function hueDistance(a: number, b: number): number {
  const d = normDeg(a - b);
  return Math.min(d, 360 - d);
}
