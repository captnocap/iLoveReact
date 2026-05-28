// JS-side geometry interning.
//
// Runs a generator ONCE per unique (id, params) and shares the result across
// every mesh instance — the JS mirror of the framework's intern cache. Without
// this, React would re-run generate() on every render and every instance; with
// it, 500 coconuts of identical params share a single generate() call and a
// single vertex array. The framework then dedups again by the same key, so the
// GPU stores one copy regardless of instance count.
//
// This module has NO dependency on the shape files or on primitives — it only
// duck-types the def ({ id, generate, defaults }) — so importing it into the
// primitives layer pulls in no geometry code a cart didn't already import.
//
// Build-time bake: `rjit bake-geometry` runs generators at build time and emits
// BAKED (./_baked.generated) keyed by the SAME internKey() the runtime computes.
// We pre-seed the cache from it on load, so a baked mesh's internGeometry() is a
// cache hit and generate() never runs in V8. A non-baked / dynamic mesh misses
// the seed and falls back to runtime generation — nothing is lost either way.

import { BAKED } from './_baked.generated';

export type GeometryDefLike = {
  id: string;
  generate: (params: any) => { positions: Float32Array; count: number; bounds: { radius: number } };
  defaults: any;
};

export type InternedGeometry = {
  /** intern key = id + '|' + stable(params); stable across instances. */
  key: string;
  /** interleaved [px,py,pz,nx,ny,nz,u,v]×count, ready to ship to the host. */
  vertices: number[];
  count: number;
  bounds: number;
};

const cache = new Map<string, InternedGeometry>();

// Pre-seed from the build-time bake. A baked entry is byte-identical to what
// runtime generation would produce (same generator, same params, same key), so
// the runtime simply finds it already present and skips generate() entirely.
for (const key of Object.keys(BAKED)) cache.set(key, BAKED[key]!);

// Deterministic stringify (recursively sorted keys) so two call sites that build
// logically-equal params in different key order still collapse to one entry.
function stable(v: any): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
}

/**
 * The canonical intern key: id + '|' + stable(resolved params). The build-time
 * bake MUST compute this identically (it imports this function) so a baked key
 * matches the runtime key exactly — that identity is what makes the pre-seed a
 * transparent hit rather than a parallel cache.
 */
export function internKey(def: GeometryDefLike, params: any): string {
  const resolved = { ...(def.defaults ?? {}), ...(params ?? {}) };
  return def.id + '|' + stable(resolved);
}

/** Run a generator and package its output as an InternedGeometry under `key`. */
export function bakeEntry(def: GeometryDefLike, params: any): InternedGeometry {
  const key = internKey(def, params);
  const data = def.generate({ ...(def.defaults ?? {}), ...(params ?? {}) });
  return { key, vertices: Array.from(data.positions), count: data.count, bounds: data.bounds.radius };
}

export function internGeometry(def: GeometryDefLike, params: any): InternedGeometry {
  const key = internKey(def, params);
  let entry = cache.get(key);
  if (!entry) {
    entry = bakeEntry(def, params);
    cache.set(key, entry);
  }
  return entry;
}

/** True if `g` is a geometry registry def (vs a legacy string like "box"). */
export function isGeometryDef(g: any): g is GeometryDefLike {
  return !!g && typeof g === 'object' && typeof g.generate === 'function' && typeof g.id === 'string';
}
