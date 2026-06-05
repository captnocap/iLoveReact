// game/items/geometries.ts — the item-specific geometry generators (V11).
//
// cart/game_item_gallery/index.tsx is the behavior reference (read, never
// moved/edited/imported). The gallery authored four custom meshes beyond the
// engine set; they are REWRITTEN here as pure `generate(params)` functions in
// the @reactjit/geometries style (the geometry-registry rule: shapes are TS
// generate fns, the framework knows zero shape names). Engine shapes
// (box/cylinder/cone/sphere/torus) come from @reactjit/geometries directly —
// see ITEM_GEOMETRIES in ./items.ts for the one name→shape table.

import { mesh, normalize, type GeometryData, type Vec3 } from '@reactjit/geometries';

export type V3 = [number, number, number];

function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function faceNormal(a: V3, b: V3, c: V3): Vec3 {
  const n = cross(sub(b, a), sub(c, a));
  return normalize(n[0], n[1], n[2]);
}

function tri(g: ReturnType<typeof mesh>, a: V3, b: V3, c: V3): void {
  const n = faceNormal(a, b, c);
  g.tri(a, n, [0, 0], b, n, [1, 0], c, n, [0.5, 1]);
}

function quad(g: ReturnType<typeof mesh>, a: V3, b: V3, c: V3, d: V3): void {
  const n = faceNormal(a, b, c);
  g.tri(a, n, [0, 0], b, n, [1, 0], c, n, [1, 1]);
  g.tri(a, n, [0, 0], c, n, [1, 1], d, n, [0, 1]);
}

export type BladeParams = { length: number; width: number; thickness: number };
export type SailParams = { width: number; height: number; thickness: number };
export type BoatHullParams = { length: number; width: number; height: number };
export type SurfboardParams = { length: number; width: number; thickness: number; segments: number };

/** Default params per generator (P2 — the gallery's authored defaults, verbatim). */
export const ITEM_GEOMETRY_DEFAULTS = {
  blade: { length: 1, width: 0.22, thickness: 0.04 } as BladeParams,
  sail: { width: 0.85, height: 1.25, thickness: 0.02 } as SailParams,
  boatHull: { length: 1.4, width: 0.62, height: 0.36 } as BoatHullParams,
  surfboard: { length: 1.55, width: 0.42, thickness: 0.07, segments: 24 } as SurfboardParams,
} as const;

/** Flat double-sided wedge: x is the length axis (heel at −0.45·L, tip at +0.58·L). */
export function generateBlade(p: BladeParams): GeometryData {
  const g = mesh();
  const z = p.thickness * 0.5;
  const heel = -p.length * 0.45;
  const tipX = p.length * 0.58;
  const w = p.width * 0.5;
  const a: V3 = [heel, -w, z], c: V3 = [heel, w, z], tip: V3 = [tipX, 0, z];
  const ab: V3 = [heel, -w, -z], cb: V3 = [heel, w, -z], tipb: V3 = [tipX, 0, -z];
  tri(g, a, tip, c);
  tri(g, cb, tipb, ab);
  quad(g, a, ab, tipb, tip);
  quad(g, tip, tipb, cb, c);
  quad(g, c, cb, ab, a);
  return g.build();
}

/** Triangular sail panel: foot from −0.15·W to +0.72·W, head at −0.12·W × height. */
export function generateSail(p: SailParams): GeometryData {
  const g = mesh();
  const z = p.thickness * 0.5;
  const a: V3 = [-p.width * 0.15, 0, z];
  const b: V3 = [p.width * 0.72, 0.1, z];
  const c: V3 = [-p.width * 0.12, p.height, z];
  const ar: V3 = [a[0], a[1], -z], br: V3 = [b[0], b[1], -z], cr: V3 = [c[0], c[1], -z];
  tri(g, a, b, c);
  tri(g, cr, br, ar);
  quad(g, a, ar, br, b);
  quad(g, b, br, cr, c);
  quad(g, c, cr, ar, a);
  return g.build();
}

/** Open-top hull: deck rectangle at y=0, keel line at −height (keel ends at ±0.74·L/2). */
export function generateBoatHull(p: BoatHullParams): GeometryData {
  const g = mesh();
  const lx = p.length * 0.5;
  const wz = p.width * 0.5;
  const h = p.height;
  const topA: V3 = [-lx, 0, -wz], topB: V3 = [lx, 0, -wz], topC: V3 = [lx, 0, wz], topD: V3 = [-lx, 0, wz];
  const keelA: V3 = [-lx * 0.74, -h, 0], keelB: V3 = [lx * 0.74, -h, 0];
  quad(g, topD, topC, topB, topA);
  tri(g, topA, topB, keelB);
  tri(g, topA, keelB, keelA);
  tri(g, topC, topD, keelA);
  tri(g, topC, keelA, keelB);
  tri(g, topB, topC, keelB);
  tri(g, topD, topA, keelA);
  return g.build();
}

/** Elliptical slab: a segmented oval outline extruded to ±thickness/2, fan-capped. */
export function generateSurfboard(p: SurfboardParams): GeometryData {
  const g = mesh();
  const top = p.thickness * 0.5;
  const bottom = -top;
  const pts: V3[] = [];
  for (let i = 0; i < p.segments; i++) {
    const a = (i / p.segments) * Math.PI * 2;
    pts.push([Math.cos(a) * p.length * 0.5, 0, Math.sin(a) * p.width * 0.5]);
  }
  const ct: V3 = [0, top, 0], cb: V3 = [0, bottom, 0];
  for (let i = 0; i < p.segments; i++) {
    const j = (i + 1) % p.segments;
    const ti: V3 = [pts[i][0], top, pts[i][2]];
    const tj: V3 = [pts[j][0], top, pts[j][2]];
    const bi: V3 = [pts[i][0], bottom, pts[i][2]];
    const bj: V3 = [pts[j][0], bottom, pts[j][2]];
    tri(g, ct, tj, ti);
    tri(g, cb, bi, bj);
    quad(g, ti, tj, bj, bi);
  }
  return g.build();
}

/**
 * The custom item geometries in the shape Scene3D.Mesh consumes for a
 * registered generator: { id, defaults, generate } (the gallery's def()
 * shape; the geometry intern cache keys on id + params).
 */
export const ITEM_CUSTOM_GEOMETRIES = {
  blade: { id: 'game-items/blade-v1', defaults: ITEM_GEOMETRY_DEFAULTS.blade, generate: generateBlade },
  sail: { id: 'game-items/sail-v1', defaults: ITEM_GEOMETRY_DEFAULTS.sail, generate: generateSail },
  boatHull: { id: 'game-items/boat-hull-v1', defaults: ITEM_GEOMETRY_DEFAULTS.boatHull, generate: generateBoatHull },
  surfboard: { id: 'game-items/surfboard-v1', defaults: ITEM_GEOMETRY_DEFAULTS.surfboard, generate: generateSurfboard },
} as const;

export type ItemCustomGeometryName = keyof typeof ITEM_CUSTOM_GEOMETRIES;
