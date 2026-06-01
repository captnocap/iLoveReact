// shaderCatalog.ts — the editor-facing art-layer registry: the game's WGSL
// shaders turned from "a bunch of magic numbers in a data[] array" into NAMED,
// range-bounded, draggable parameters, organized as LAYERS.
//
// A material's look is a layer stack: a shared BASE (e.g. asphalt) plus one
// VARIANT overlay (e.g. the yellow centerline) painted on top. The base is
// authored ONCE and every variant inherits it — edit the asphalt and the
// yellow/white/bike tiles all update, because they sit on the same base. That's
// exactly the layer order the road shader already used inline (fill_road first,
// then mix the markings).
//
// The shader STRING + scale constants are imported from the game (single source
// of truth — no WGSL copied). What's new here is only the editor metadata
// (labels + ranges) and `buildData`, which packs the live values into the exact
// data[] array the shader's fs_main reads.

import { ROAD_TILE_SHADER } from '../hmsc/render3d/roadTileFill';

export interface ShaderParam {
  key: string;
  label: string;
  default: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  integer?: boolean;
}

// One overlay child — sits on the shared base and adds its own layer.
export interface ShaderVariant {
  id: string;
  label: string;
  value: number; // the selector the shader reads (data[0]) to pick this overlay
  params: ShaderParam[]; // this overlay's own sliders (empty = nothing to tune)
}

export interface ShaderSpec {
  id: string;
  label: string;
  blurb: string;
  shader: string; // the real WGSL string, imported from the game
  base: ShaderParam[]; // shared across every variant (the asphalt look)
  variants: ShaderVariant[]; // the overlay children (>= 1)
  // Pack base + overlay values into the exact data[] fs_main expects.
  buildData: (variantValue: number, base: Record<string, number>, overlay: Record<string, number>) => number[];
}

// ── Road, decomposed into one-tile layered materials ─────────────────────────
// Base = asphalt (shared). Variants = the per-tile overlays a road is built from.
// See roadTileFill.ts for the D[] layout.
const ROAD: ShaderSpec = {
  id: 'road',
  label: 'Road',
  blurb: 'One road tile: shared asphalt base + the lane/centerline/bike overlay.',
  shader: ROAD_TILE_SHADER,
  base: [
    { key: 'brightness', label: 'Asphalt brightness', default: 1, min: 0.4, max: 1.6, step: 0.05 },
    { key: 'speckle', label: 'Asphalt grain', default: 0.12, min: 0, max: 0.4, step: 0.01 },
  ],
  variants: [
    { id: 'asphalt', label: 'Asphalt (base)', value: 0, params: [] },
    {
      id: 'yellow', label: 'Yellow Center', value: 1, params: [
        { key: 'lineHalf', label: 'Line thickness', default: 0.05, min: 0.02, max: 0.2, step: 0.005, unit: 'm' },
        { key: 'doubleGap', label: 'Double-line gap', default: 0.12, min: 0, max: 0.4, step: 0.01, unit: 'm' },
      ],
    },
    {
      id: 'white', label: 'White Divider', value: 2, params: [
        { key: 'lineHalf', label: 'Line thickness', default: 0.05, min: 0.02, max: 0.2, step: 0.005, unit: 'm' },
        { key: 'dashPeriod', label: 'Dash period', default: 0.35, min: 0.1, max: 1, step: 0.05, unit: 'm' },
        { key: 'dashFrac', label: 'Dash on-fraction', default: 0.5, min: 0.05, max: 0.95, step: 0.05 },
      ],
    },
    {
      id: 'bike', label: 'Bike Lane', value: 3, params: [
        { key: 'bikeEdge', label: 'Edge-line thickness', default: 0.05, min: 0.02, max: 0.2, step: 0.005, unit: 'm' },
      ],
    },
  ],
  buildData: (variantValue, base, o) => [
    variantValue,
    base.brightness,
    base.speckle,
    o.lineHalf ?? 0.05,
    o.doubleGap ?? 0.12,
    o.dashPeriod ?? 0.35,
    o.dashFrac ?? 0.5,
    o.bikeEdge ?? 0.05,
  ],
};

export const HMSC_SHADERS: ShaderSpec[] = [ROAD];

export function shaderSpec(id: string): ShaderSpec | undefined {
  return HMSC_SHADERS.find((s) => s.id === id);
}

// Default value maps — the slider starting positions for the base and a variant.
export function paramDefaults(params: ShaderParam[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of params) out[p.key] = p.default;
  return out;
}
