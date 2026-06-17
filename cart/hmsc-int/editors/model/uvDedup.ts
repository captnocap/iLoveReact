// editors/model/uvDedup.ts — UV island DEDUP (req_1254/req_1255). The GUIDING_LIGHT
// "store each distinct thing once, reference it everywhere" law, applied to the
// texture atlas: a boxy model has hundreds of faces but only a handful of DISTINCT
// face SHAPES (every same-size panel, every solidify rim sliver is congruent). The
// per-face unwrap packs one island per face — the PRODUCT. This keeps the FACTORS:
// one island per distinct shape, every congruent face referencing it.
//
// The key insight that makes it trivial + exactly correct: a face's projected
// island poly is MIN-NORMALIZED to its own origin, so two congruent faces have an
// IDENTICAL point set. Place each at the same atlas slot and every corner lands on
// the same texel by spatial position — no per-face remap, no rotation bookkeeping.
// So this module only has to answer ONE question: "do these two faces have the
// same shape?" — via a canonical key invariant to loop-start + winding.
//
// Pure + headless (the editMesh idiom), unit-testable.

import type { V2 } from './editMesh';

/** A stable shape fingerprint for a face's (min-normalized) local poly. Invariant
 *  to where the loop STARTS and which WINDING it runs (a face and its reverse-wound
 *  solidify twin hash the same), so congruent faces collapse to one key. NOT
 *  invariant to a 90° spatial rotation (a w×h vs an h×w rect stay distinct) — that
 *  is a deliberate v1 bound: it keeps the mapping a pure spatial placement with no
 *  rotation transform, which is what makes dedup provably non-distorting. `q` is the
 *  rounding quantum (texels ×100) that absorbs float noise; congruent faces share
 *  identical geometry so they round identically. */
export function faceShapeKey(local: V2[], q = 100): string {
  const L = local.length;
  if (L === 0) return '0|';
  const r = (p: V2) => `${Math.round(p[0] * q)},${Math.round(p[1] * q)}`;
  // canonical = the lexicographically smallest serialization over every loop start
  // and both directions. The point SET is start/winding-independent (min-normalized),
  // so only the traversal order varies; the min over orders is the canonical form.
  let best: string | null = null;
  for (let dir = 1; dir >= -1; dir -= 2) {
    for (let s = 0; s < L; s += 1) {
      let ser = '';
      for (let i = 0; i < L; i += 1) {
        const idx = (((s + dir * i) % L) + L) % L;
        ser += (i ? ';' : '') + r(local[idx]);
      }
      if (best === null || ser < best) best = ser;
    }
  }
  return `${L}|${best}`;
}

/** Group items carrying a local poly by shape. Returns, for each distinct shape, the
 *  list of member indices with the FIRST as representative (deterministic — the
 *  caller feeds items in a stable order). Generic over the item so both the scene
 *  textureize (part/face raws) and a future per-part unwrap can share it. */
export function groupByShape<T>(items: T[], localOf: (t: T) => V2[]): { rep: number; members: number[] }[] {
  const groups: { rep: number; members: number[] }[] = [];
  const byKey = new Map<string, number>(); // key → index into groups
  items.forEach((it, i) => {
    const key = faceShapeKey(localOf(it));
    const g = byKey.get(key);
    if (g === undefined) { byKey.set(key, groups.length); groups.push({ rep: i, members: [i] }); }
    else groups[g].members.push(i);
  });
  return groups;
}
