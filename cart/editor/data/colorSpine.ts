// editor/data/colorSpine.ts — the Color Library's spine: one current color +
// one saved palette, with pure derivations (fits/ramp/pigments/scene/sets)
// that ColorLibraryPanel shows ALL AT ONCE (req_2501 — the five lens tabs and
// the No-Modes orbit are gone; they were five faces of the same derivations).
// Pure data + pure helpers, same shape as colorStudio.ts (which owns the
// Material Palette / shader slots).
import { hueDistance, oklchToHex, rgb01ToOklch, rotateHue, type OklchColor } from '../../../runtime/paint/colors';

export const SPINE_DEFAULT_CURRENT: OklchColor = { l: 0.68, c: 0.15, h: 55 };

/** Raw use-history cap — RECENT holds this many, newest first (req_3097). */
export const SPINE_RECENTS_CAP = 14;

/** Record a used color into the raw history: newest first, deduped by hex, capped.
 *  Every color-select commit funnels through here — pick it once, it's never lost. */
export function pushRecentColor(recents: OklchColor[], color: OklchColor): OklchColor[] {
  const hex = oklchToHex(color);
  const rest = recents.filter((c) => oklchToHex(c) !== hex);
  return [{ ...color }, ...rest].slice(0, SPINE_RECENTS_CAP);
}

const NAME_BANDS: Array<[number, string]> = [
  [15, 'red'], [45, 'amber'], [80, 'citron'], [140, 'green'], [195, 'teal'],
  [250, 'blue'], [305, 'violet'], [345, 'magenta'], [360, 'red'],
];

export function oklchName(color: OklchColor): string {
  const hue = ((color.h % 360) + 360) % 360;
  let base = 'red';
  for (const [deg, name] of NAME_BANDS) {
    if (hue <= deg) { base = name; break; }
  }
  const tone = color.l > 0.8 ? 'pale' : color.l > 0.62 ? 'bright' : color.l > 0.45 ? 'deep' : 'dark';
  return `${tone} ${base}`;
}

export function oklchReadout(color: OklchColor): string {
  const hue = ((color.h % 360) + 360) % 360;
  return `L ${Math.round(color.l * 100)} · C ${Math.round(color.c * 100)} · H ${Math.round(hue)}°`;
}

export type FitEntry = { label: string; color: OklchColor; css: string };

const FIT_OFFSETS: Array<{ dH: number; label: string }> = [
  { dH: -30, label: 'analogous' },
  { dH: 30, label: 'analogous' },
  { dH: 150, label: 'split' },
  { dH: 180, label: 'complement' },
  { dH: -150, label: 'split' },
];

/** "Fits well right now" — harmony derivations, re-derived live from the current color. */
export function fitsWellNow(current: OklchColor): FitEntry[] {
  return FIT_OFFSETS.map((f) => {
    const color = f.dH === 0 ? current : rotateHue(current, f.dH);
    return { label: f.label, color, css: oklchToHex(color) };
  });
}

export type Pigment = { name: string; color: OklchColor; css: string };

const MIX_PIGMENT_DEFS: Array<{ name: string; l: number; c: number; h: number }> = [
  { name: 'Cadmium', l: 0.55, c: 0.18, h: 28 },
  { name: 'Ochre', l: 0.70, c: 0.13, h: 70 },
  { name: 'Cerulean', l: 0.60, c: 0.12, h: 230 },
  { name: 'Viridian', l: 0.55, c: 0.13, h: 155 },
  { name: 'Rose', l: 0.62, c: 0.16, h: 5 },
  { name: 'Titanium', l: 0.93, c: 0.02, h: 90 },
];

/** Pigment Lab reference dabs — click pulls that pigment into current. */
export function mixPigments(): Pigment[] {
  return MIX_PIGMENT_DEFS.map((p) => {
    const color: OklchColor = { l: p.l, c: p.c, h: p.h };
    return { name: p.name, color, css: oklchToHex(color) };
  });
}

export type SceneSwatch = { color: OklchColor; css: string; picked: boolean };

/** The colors REALLY in the scene: the host's dominant-color read of the live paint
 *  atlas (__model_atlas_palette, req_3097 — the hardcoded pretend-scene rows are gone).
 *  Empty when nothing is adopted for paint, and the SCENE section hides itself. */
export function sceneSwatches(pickedCss: string | null): SceneSwatch[] {
  const door = (globalThis as any).__model_atlas_palette as ((n: number) => unknown) | undefined;
  if (!door) return [];
  let rgbs: unknown;
  try { rgbs = JSON.parse(String(door(7) ?? '[]')); } catch { return []; }
  if (!Array.isArray(rgbs)) return [];
  return rgbs
    .filter((t): t is [number, number, number] => Array.isArray(t) && t.length === 3)
    .map(([r, g, b]) => {
      const color = rgb01ToOklch(r / 255, g / 255, b / 255);
      const css = oklchToHex(color);
      return { color, css, picked: css === pickedCss };
    });
}

export type RampStep = { color: OklchColor; css: string };

/** Ramp — perceptually even OKLCH shadow→light steps with cool-shadow /
 *  warm-highlight hue drift. Spans near-black to near-white so the ramp is
 *  also a fast road to the extremes (req_2500). */
export function rampForge(current: OklchColor, steps: number): RampStep[] {
  const out: RampStep[] = [];
  const n = Math.max(2, steps);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const l = 0.08 + (0.97 - 0.08) * t;
    const c = current.c * (1 + 0.22 * Math.sin(Math.PI * t));
    const h = current.h + (t - 0.5) * -42;
    const color: OklchColor = { l, c, h };
    out.push({ color, css: oklchToHex(color) });
  }
  return out;
}

export type SpinePaletteSet = { name: string; colors: OklchColor[] };

/** Curated aesthetic palettes for the Library lens. Store-vs-fetch: this is the
 *  local curated set; "discover online" is an import into this list via the
 *  Zig fetch suite, never a live per-pick dependency (see DESIGN_INTAKE.md). */
export const SPINE_LIBRARY: SpinePaletteSet[] = [
  { name: 'Dune Dusk', colors: [{ l: .45, c: .10, h: 40 }, { l: .66, c: .14, h: 60 }, { l: .82, c: .09, h: 85 }, { l: .48, c: .07, h: 255 }] },
  { name: 'Ember', colors: [{ l: .35, c: .10, h: 25 }, { l: .55, c: .18, h: 35 }, { l: .70, c: .15, h: 55 }, { l: .25, c: .04, h: 30 }] },
  { name: 'Saffron Market', colors: [{ l: .60, c: .15, h: 70 }, { l: .74, c: .14, h: 85 }, { l: .55, c: .16, h: 45 }, { l: .40, c: .09, h: 30 }] },
  { name: 'Coral Reef', colors: [{ l: .62, c: .16, h: 25 }, { l: .72, c: .13, h: 42 }, { l: .68, c: .11, h: 190 }, { l: .50, c: .10, h: 210 }] },
  { name: 'Mossbank', colors: [{ l: .40, c: .08, h: 150 }, { l: .58, c: .12, h: 140 }, { l: .74, c: .13, h: 120 }, { l: .85, c: .10, h: 100 }] },
  { name: 'Glacier', colors: [{ l: .45, c: .08, h: 235 }, { l: .62, c: .10, h: 215 }, { l: .78, c: .07, h: 200 }, { l: .90, c: .04, h: 220 }] },
  { name: 'Orchid Smoke', colors: [{ l: .45, c: .10, h: 320 }, { l: .60, c: .14, h: 300 }, { l: .72, c: .10, h: 340 }, { l: .50, c: .06, h: 270 }] },
  { name: 'Nightshade', colors: [{ l: .30, c: .06, h: 260 }, { l: .50, c: .12, h: 280 }, { l: .65, c: .13, h: 200 }, { l: .45, c: .10, h: 240 }] },
];

const LIBRARY_MATCH_THRESHOLD_DEG = 26;

export type LibraryRow = {
  name: string;
  matched: boolean;
  matchedIndex: number;
  swatches: Array<{ color: OklchColor; css: string; isMatch: boolean }>;
};

/** A set "matches" if any of its colors is within ~26deg hue of current — the
 *  matched swatch gets ringed and the set gets a "has yours" tag. */
export function libraryRows(current: OklchColor): LibraryRow[] {
  return SPINE_LIBRARY.map((set) => {
    let matchedIndex = -1;
    let best = Infinity;
    set.colors.forEach((c, index) => {
      const d = hueDistance(c.h, current.h);
      if (d < best) { best = d; matchedIndex = index; }
    });
    const matched = best <= LIBRARY_MATCH_THRESHOLD_DEG;
    return {
      name: set.name,
      matched,
      matchedIndex,
      swatches: set.colors.map((c, index) => ({ color: c, css: oklchToHex(c), isMatch: matched && index === matchedIndex })),
    };
  });
}
