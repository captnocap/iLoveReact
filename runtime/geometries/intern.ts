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

// Deterministic stringify (recursively sorted keys) so two call sites that build
// logically-equal params in different key order still collapse to one entry.
function stable(v: any): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
}

export function internGeometry(def: GeometryDefLike, params: any): InternedGeometry {
  const resolved = { ...(def.defaults ?? {}), ...(params ?? {}) };
  const key = def.id + '|' + stable(resolved);
  let entry = cache.get(key);
  if (!entry) {
    const data = def.generate(resolved);
    entry = {
      key,
      vertices: Array.from(data.positions),
      count: data.count,
      bounds: data.bounds.radius,
    };
    cache.set(key, entry);
  }
  return entry;
}

/** True if `g` is a geometry registry def (vs a legacy string like "box"). */
export function isGeometryDef(g: any): g is GeometryDefLike {
  return !!g && typeof g === 'object' && typeof g.generate === 'function' && typeof g.id === 'string';
}
