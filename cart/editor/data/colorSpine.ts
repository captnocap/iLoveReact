// editor/data/colorSpine.ts — the unified Color Studio spine: one current
// color + one palette tray, with pure derivations for each lens (Field, Mix,
// Scene, Ramp, Library) and the No-Modes orbit. Mirrors turn 3a of
// design_handoff_color_studio/Color Pickers.dc.html — see DESIGN_INTAKE.md
// "Color Studio: Material/Shader-Aware Color Tool". Pure data + pure helpers,
// same shape as colorStudio.ts (which owns the Material Palette / turn 4a).
import { hueDistance, oklchToHex, rotateHue, type OklchColor } from '../../../runtime/paint/colors';

export const SPINE_DEFAULT_CURRENT: OklchColor = { l: 0.68, c: 0.15, h: 55 };

export const SPINE_DEFAULT_PALETTE: OklchColor[] = [
  { l: 0.55, c: 0.18, h: 28 },
  { l: 0.60, c: 0.12, h: 230 },
  { l: 0.70, c: 0.13, h: 155 },
];

export const LENS_ORDER = ['field', 'mix', 'scene', 'ramp', 'library'] as const;
export type ColorLens = typeof LENS_ORDER[number];

export const LENS_LABELS: Record<ColorLens, string> = {
  field: 'Field',
  mix: 'Mix',
  scene: 'Scene',
  ramp: 'Ramp',
  library: 'Library',
};

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

/** "Fits well right now" — re-derives live from the current color. Shared by Workbench and No-Modes. */
export function fitsWellNow(current: OklchColor): FitEntry[] {
  return FIT_OFFSETS.map((f) => {
    const color = f.dH === 0 ? current : rotateHue(current, f.dH);
    return { label: f.label, color, css: oklchToHex(color) };
  });
}

export type FieldNode = { color: OklchColor; css: string; isCurrent: boolean; xPct: number; yPct: number };

const FIELD_OFFSETS = [0, -30, 30, 180];

/** Flat hue/lightness field for the Field lens — no wheel. */
export function fieldNodes(current: OklchColor): FieldNode[] {
  return FIELD_OFFSETS.map((dH, index) => {
    const color = dH === 0 ? current : rotateHue(current, dH);
    const hue = ((color.h % 360) + 360) % 360;
    return { color, css: oklchToHex(color), isCurrent: index === 0, xPct: (hue / 360) * 100, yPct: (1 - color.l) * 100 };
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

const SCENE_COLOR_DEFS: OklchColor[] = [
  { l: 0.30, c: 0.06, h: 245 }, { l: 0.48, c: 0.07, h: 200 }, { l: 0.70, c: 0.05, h: 210 },
  { l: 0.80, c: 0.08, h: 90 }, { l: 0.72, c: 0.12, h: 62 }, { l: 0.55, c: 0.14, h: 35 }, { l: 0.22, c: 0.03, h: 250 },
];

/** World Sampler extraction — colors already present in "the current scene". */
export function sceneSwatches(pickedCss: string | null): SceneSwatch[] {
  return SCENE_COLOR_DEFS.map((color) => {
    const css = oklchToHex(color);
    return { color, css, picked: css === pickedCss };
  });
}

export type RampStep = { color: OklchColor; css: string };

/** Ramp Forge — perceptually even OKLCH ramp with cool-shadow/warm-highlight hue drift. */
export function rampForge(current: OklchColor, steps: number): RampStep[] {
  const out: RampStep[] = [];
  const n = Math.max(2, steps);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const l = 0.30 + (0.95 - 0.30) * t;
    const c = current.c * (1 + 0.22 * Math.sin(Math.PI * t));
    const h = current.h + (t - 0.5) * -42;
    const color: OklchColor = { l, c, h };
    out.push({ color, css: oklchToHex(color) });
  }
  return out;
}

export function rampBarCss(current: OklchColor): string {
  const a = oklchToHex({ l: 0.30, c: current.c, h: current.h + 21 });
  const b = oklchToHex({ l: 0.62, c: current.c * 1.2, h: current.h });
  const c = oklchToHex({ l: 0.95, c: current.c, h: current.h - 21 });
  return `linear-gradient(90deg, ${a}, ${b}, ${c})`;
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
