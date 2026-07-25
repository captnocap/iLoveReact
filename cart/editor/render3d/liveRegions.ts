// render3d/liveRegions.ts — the ONE owner of the host's region formula
// (req_3402/req_3423 — the world slice of live material regions).
//
// The studio viewer (ModelView) and the world's placed props (livePush) both
// bind live material regions, but the host holds ONE composed region formula.
// Two independent pushers would clobber each other: the loser's materialId
// falls through the composed if-chain to the loud magenta fallback. So every
// pusher routes through ensureRegionFormula, which UNIONS the bound material
// fns for the whole session and recomposes only when the union grows — the
// host hash-gates the compile, so re-pushing an unchanged union is free and a
// grown one costs a single small module (~20 KB per material, req_3400).
//
// The union only grows within a session (an unbound material costs a few
// unused bytes of WGSL, never a recompile), which keeps rebinding instant.
import { buildRegionFormula } from './regionFormula';

const host = globalThis as any;
const boundFns = new Set<string>();
let pushedSig = '';

/** Fold `fns` into the session union and make sure the host's region formula
 *  covers all of it. Returns false (loudly, via buildRegionFormula) when a fn
 *  is unknown — callers must then skip their region binds rather than draw
 *  magenta. */
export function ensureRegionFormula(fns: readonly string[]): boolean {
  for (const fn of fns) boundFns.add(fn);
  const all = [...boundFns].sort();
  if (all.length === 0) return false;
  const sig = all.join('|');
  if (sig === pushedSig) return true;
  if (typeof host.__model_region_formula !== 'function') return false;
  const formula = buildRegionFormula(all);
  if (!formula) return false;
  if (host.__model_region_formula(formula) !== 1) return false;
  pushedSig = sig;
  return true;
}
