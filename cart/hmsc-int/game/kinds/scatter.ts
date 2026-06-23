// game/kinds/scatter.ts — procedural nature brushes (SCATTERBRUSH-0611,
// req_0642 "a procedural paint tool for grass trees and rocks").
//
// A scatter brush is DATA: a weighted mix of prop kinds + a per-tile density.
// Painting with one stamps ORDINARY prop placements (cat 'prop') through the
// same place pipeline a hand-dropped rock uses — erase/move/select/compile all
// work per prop, and nothing downstream knows scatter exists.
//
// The roll is DETERMINISTIC per (brush, tile): a hash of the tile coordinate
// decides whether that tile gets a prop, which kind, and its rotation. Same
// stroke twice over the same ground = the same answer, so repainting never
// double-fills (the painter also skips tiles that already hold a prop), and
// the roll is pure and testable.

import type { PropKind } from './props';
import { isPropKind } from './props';

export type ScatterBrushId = 'meadow' | 'forest' | 'rocky';

export type ScatterEntry = { kind: PropKind; weight: number };

export type ScatterBrushDef = {
  id: ScatterBrushId;
  label: string;
  /** palette chip + brush tint */
  color: string;
  /** chance a painted tile receives a prop, 0..1 */
  density: number;
  entries: ScatterEntry[];
};

export const SCATTER_BRUSHES: Record<ScatterBrushId, ScatterBrushDef> = {
  meadow: {
    id: 'meadow',
    label: 'Meadow (scatter)',
    color: '#5a9a42',
    density: 0.45,
    entries: [
      { kind: 'grassPatch', weight: 6 },
      { kind: 'grassTall', weight: 3 },
      { kind: 'bushLow', weight: 1 },
      { kind: 'bushSparse', weight: 1 },
      { kind: 'rockSmall', weight: 0.5 },
    ],
  },
  forest: {
    id: 'forest',
    label: 'Forest (scatter)',
    color: '#2f6b2f',
    density: 0.3,
    entries: [
      { kind: 'treeOak', weight: 2 },
      { kind: 'treePine', weight: 2 },
      { kind: 'treeBirch', weight: 1 },
      { kind: 'treeOakYoung', weight: 1.5 },
      { kind: 'treePineYoung', weight: 1.5 },
      { kind: 'grassPatch', weight: 4 },
      { kind: 'grassTall', weight: 2 },
      { kind: 'rockMossy', weight: 0.5 },
    ],
  },
  rocky: {
    id: 'rocky',
    label: 'Rocky (scatter)',
    color: '#82868d',
    density: 0.4,
    entries: [
      { kind: 'rockSmall', weight: 3 },
      { kind: 'rock', weight: 2 },
      { kind: 'rockJagged', weight: 1.5 },
      { kind: 'grassPatch', weight: 1.5 },
      { kind: 'rockPile', weight: 1 },
      { kind: 'rockFlat', weight: 1 },
      { kind: 'rockLarge', weight: 0.8 },
      { kind: 'rockShard', weight: 0.4 },
      { kind: 'boulder', weight: 0.3 },
    ],
  },
};

export const SCATTER_BRUSH_IDS = Object.keys(SCATTER_BRUSHES) as ScatterBrushId[];

export function isScatterBrushId(value: string): value is ScatterBrushId {
  return Object.prototype.hasOwnProperty.call(SCATTER_BRUSHES, value);
}

// ── the deterministic roll ───────────────────────────────────────────────────

// Exported: the deterministic-paint roll is shared with the grass surface
// population (render3d/grassField), which is a scatter of blades over grass-tile
// cells — same pure hash, same repaint-stability guarantee.
export function mix(a: number): number {
  let h = a >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

function seedOf(id: string): number {
  let s = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) s = Math.imul(s ^ id.charCodeAt(i), 0x01000193);
  return s >>> 0;
}

/** hash → uniform [0,1) */
export function unit(h: number): number {
  return (h >>> 8) / 0x1000000;
}

export type ScatterRoll = { kind: PropKind; rotation: number };

/**
 * The pure per-tile roll: null (most tiles) or a prop kind + yaw. Deterministic
 * in (brush, tileX, tileZ) — see the module header for why that matters.
 */
export function scatterRollAt(brush: ScatterBrushDef, tileX: number, tileZ: number): ScatterRoll | null {
  const base = mix(seedOf(brush.id) ^ Math.imul(tileX | 0, 0x85ebca6b) ^ Math.imul(tileZ | 0, 0xc2b2ae35));
  if (unit(base) >= brush.density) return null;
  const pickRoll = unit(mix(base ^ 0x9e3779b9));
  let total = 0;
  for (const entry of brush.entries) total += entry.weight;
  let acc = 0;
  let kind: PropKind = brush.entries[0].kind;
  for (const entry of brush.entries) {
    acc += entry.weight;
    if (pickRoll * total < acc) { kind = entry.kind; break; }
  }
  if (!isPropKind(kind)) return null;
  // yaw in 15° steps — enough variety to break the grid read, still tidy
  const rotation = (mix(base ^ 0x68bc21eb) % 24) * 15;
  return { kind, rotation };
}
