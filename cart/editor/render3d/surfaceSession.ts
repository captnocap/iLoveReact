// render3d/surfaceSession.ts — the ONE owner of the host's projected-surface
// formula pair (the liveRegions.ts discipline, req_4785).
//
// The host holds ONE composed (compute, render) module pair for every
// installed projected surface. Independent pushers — the /surface-demo route,
// the wall-finish lane, a future Surface Lab preview — would clobber each
// other: the loser's selector would dispatch into the wrong module or the
// loud-magenta fallback. So every pusher routes through ensureSurfaceSession,
// which UNIONS the session's packages and recomposes only when the union
// GROWS. The host hash-gates the compile, so re-pushing an unchanged union is
// free; selectors are stable for the session lifetime because entries only
// append.
import {
  composeSurfaceSession,
  type SurfacePackageV1,
  type SurfaceSessionEntry,
} from './shaders/surfacePackage';

const host = globalThis as any;
const union = new Map<string, SurfaceSessionEntry>();
let selectors = new Map<string, number>();
let pushedSig = '';

/** Fold `entries` into the session union and make sure the host's formula
 *  pair covers all of it. Returns the package-id → selector map to stamp into
 *  each instance's D section (surfacePackageData), or null when the host door
 *  is absent or composition failed (callers must then skip their installs
 *  rather than draw magenta). A package id re-registered with a DIFFERENT
 *  shape keeps its first entry — package ids are content identities; mint a
 *  new id for a new shape. */
export function ensureSurfaceSession(entries: readonly SurfaceSessionEntry[]): Map<string, number> | null {
  for (const entry of entries) {
    if (!union.has(entry.pkg.id)) union.set(entry.pkg.id, entry);
  }
  if (union.size === 0) return null;
  // INSERTION order, never sorted: a selector is stamped into every installed
  // surface's D section, so it must stay stable for the session's lifetime.
  // Sorting here re-assigned selectors when a new package joined mid-session
  // and every already-installed surface dispatched into the WRONG module —
  // the rust wall rendered 76mm-relief brick, caught by the bounds gate
  // (req_4786). Map iteration preserves insertion; entries only append.
  const all = [...union.values()];
  const sig = all.map((e) => e.pkg.id).join('|');
  if (sig === pushedSig) return selectors;
  if (typeof host.__surface_package_formula !== 'function') return null;
  const session = composeSurfaceSession(all);
  if (!session) return null;
  if (host.__surface_package_formula(session.computeWgsl, session.renderWgsl) !== 1) return null;
  selectors = session.selectors;
  pushedSig = sig;
  return selectors;
}

/** The selector a package's D section must carry, once ensured. */
export function surfaceSelectorFor(pkg: SurfacePackageV1): number | null {
  return selectors.get(pkg.id) ?? null;
}
