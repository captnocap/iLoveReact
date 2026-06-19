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
