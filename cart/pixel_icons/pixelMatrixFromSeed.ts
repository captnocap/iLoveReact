// pixelMatrixFromSeed — deterministic procedural PixelMatrix from a u32 seed.
//
// Produces small symmetric pixel icons suitable for NPC avatars, achievement
// glyphs, token mascots, ad creatives — anywhere we need a stable face for an
// identity without authoring art. Same seed → same matrix, always.
//
// Algorithm:
//   1. mulberry32 PRNG seeded with `seed`
//   2. Roll an HSL base hue (or take override) → derive `paletteSize` colors
//      stepping the hue + jittering saturation/lightness
//   3. Fill the LEFT HALF of an NxN grid with palette indices weighted toward
//      early indices (lighter colors dominate, accents are sparse); mirror to
//      the right half for `mirror='lr'` (the GitHub-identicon look)
//   4. Cell-occupancy probability drops slightly near edges so most icons feel
//      framed rather than full-bleed
//
// Cost: O(size²). At size=16, ~256 cells, negligible — generate at render
// time without caching.

import type { PixelMatrix } from './PixelIcon';

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hslToHex(h: number, s: number, l: number): string {
  // h in [0,360), s,l in [0,1]
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return '#' + f(0) + f(8) + f(4);
}

export type PixelMatrixOpts = {
  /** Grid edge in cells. Default 16. Keep small — 8/12/16 read well at icon scale. */
  size?: number;
  /** Distinct colors generated (excluding null/transparent). Default 5. */
  paletteSize?: number;
  /** Base hue 0..360. Default: derived from seed (each NPC gets a stable color family). */
  baseHue?: number;
  /** Fill probability per cell in [0,1]. Default 0.55. */
  fillRate?: number;
  /** Mirroring. 'lr' = GitHub identicon symmetry. Default 'lr'. */
  mirror?: 'lr' | 'tb' | 'quad' | 'none';
  /** If provided, palette overrides the auto-generated colors. */
  palette?: string[];
};

export function pixelMatrixFromSeed(seed: number, opts: PixelMatrixOpts = {}): PixelMatrix {
  const size = opts.size ?? 16;
  const paletteSize = opts.paletteSize ?? 5;
  const fillRate = opts.fillRate ?? 0.55;
  const mirror = opts.mirror ?? 'lr';
  const rng = mulberry32(seed);

  // Palette
  const palette: string[] = opts.palette ? opts.palette.slice() : [];
  if (palette.length === 0) {
    const baseHue = opts.baseHue ?? Math.floor(rng() * 360);
    for (let i = 0; i < paletteSize; i++) {
      const hue = (baseHue + i * (60 + rng() * 30)) % 360;
      const sat = 0.55 + rng() * 0.35;
      const lum = 0.42 + rng() * 0.20;
      palette.push(hslToHex(hue, sat, lum));
    }
  }

  // Half-grid generation (then mirror)
  const halfW = mirror === 'lr' || mirror === 'quad' ? Math.ceil(size / 2) : size;
  const halfH = mirror === 'tb' || mirror === 'quad' ? Math.ceil(size / 2) : size;
  const pixels: Array<number | null> = new Array(size * size).fill(null);

  for (let y = 0; y < halfH; y++) {
    for (let x = 0; x < halfW; x++) {
      // Edge-bias: cells near the outer border are slightly less likely to
      // fill — frames the icon.
      const edgeFactor =
        Math.min(x, y, size - 1 - x, size - 1 - y) <= 0 ? 0.55 : 1.0;
      if (rng() > fillRate * edgeFactor) continue;
      // Skew toward palette index 0 (most common color) with rare accents.
      const u = rng();
      const idx = u < 0.55 ? 0
                : u < 0.80 ? 1
                : u < 0.92 ? 2 % palette.length
                : u < 0.98 ? 3 % palette.length
                : 4 % palette.length;
      pixels[y * size + x] = idx;
    }
  }

  // Mirror
  if (mirror === 'lr' || mirror === 'quad') {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < Math.floor(size / 2); x++) {
        const left = pixels[y * size + x];
        if (left == null) continue;
        pixels[y * size + (size - 1 - x)] = left;
      }
    }
  }
  if (mirror === 'tb' || mirror === 'quad') {
    for (let y = 0; y < Math.floor(size / 2); y++) {
      for (let x = 0; x < size; x++) {
        const top = pixels[y * size + x];
        if (top == null) continue;
        pixels[(size - 1 - y) * size + x] = top;
      }
    }
  }

  return { size, palette, pixels };
}

/** Convenience: derive a stable u32 seed from an arbitrary string (e.g.
 *  an EVM address or a token symbol). djb2 hash — collision rate is fine
 *  for icon distinctiveness purposes; we are not authenticating anything. */
export function seedFromString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}
