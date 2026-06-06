// editors/paint/colors.ts - reusable paint color math.

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

export function hexToHsv(hex: string | null | undefined): HsvColor {
  const h = normalizeHexColor(hex);
  const r = parseInt(h.slice(1, 3), 16) / 255;
  const g = parseInt(h.slice(3, 5), 16) / 255;
  const b = parseInt(h.slice(5, 7), 16) / 255;
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

  return {
    h: hue,
    s: max === 0 ? 0 : d / max,
    v: max,
  };
}

export function hsvToHex(color: HsvColor): string {
  const h = normHue(color.h) * 6;
  const s = clamp01(color.s);
  const v = clamp01(color.v);
  const i = Math.floor(h);
  const f = h - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  let r = v, g = t, b = p;
  switch (i % 6) {
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }

  return `#${byteHex(r * 255)}${byteHex(g * 255)}${byteHex(b * 255)}`;
}
