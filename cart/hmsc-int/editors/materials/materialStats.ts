// editors/materials/materialStats.ts — MATERIAL census for the / dashboard
// (req_1882). The texture census counts only RASTER bitmaps, but most of this
// game's surface richness is procedural: shader-recipe materials (the MATERIALS
// pipeline) the user Materializes, plus the built-in shader recipes. This counts
// those — the "dozens of shaders" the raster count was missing.
//
// Pure read over the materials stream + the static shader catalog — cheap, no
// decode, freeze-law-safe. Runs in the dashboard's deferred census effect.

import { editorChannel } from '../store';
import { materialsStream } from './stream';
import { HMSC_SHADERS } from '../../game/textures/shaders';

export type MaterialCensus = {
  /** user-Materialized materials (the authored catalog). */
  authored: number;
  /** authored materials backed by a shader recipe. */
  shaderBased: number;
  /** authored materials backed by a composed decal doc. */
  decalBased: number;
  /** built-in shader recipes available to Materialize from. */
  builtinShaders: number;
};

/** Pure tally of authored material records by their source kind. */
export function tallyMaterials(records: ReadonlyArray<{ shaderId?: string; decal?: unknown }>): Omit<MaterialCensus, 'builtinShaders'> {
  let authored = 0, shaderBased = 0, decalBased = 0;
  for (const m of records) {
    authored += 1;
    if (m.shaderId) shaderBased += 1;
    else if (m.decal) decalBased += 1;
  }
  return { authored, shaderBased, decalBased };
}

/** Census the authored materials store + the built-in shader catalog. Headless-safe. */
export function reportMaterialCensus(): MaterialCensus {
  let tally = { authored: 0, shaderBased: 0, decalBased: 0 };
  try {
    tally = tallyMaterials(Object.values(editorChannel(materialsStream).state().materials ?? {}));
  } catch { /* no __fs_* host — still report the built-in shaders */ }
  return { ...tally, builtinShaders: HMSC_SHADERS.length };
}
