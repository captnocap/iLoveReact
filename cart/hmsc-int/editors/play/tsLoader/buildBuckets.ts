// buildBuckets.ts — lower a decoded LoadedScene's packed instance buffer into the
// render buckets the editor's instanced path already consumes (the SAME
// <Scene3D.Instances geometry data count stride={12}> shape pieceMeshes.tsx emits).
//
// This is the render half of "load like world_loader": world_loader.zig's
// buildShapeBatches groups the flat instance rows by shape (+material) into one
// instanced draw per group. We do the exact same grouping in TS — the decoded
// rows are ALREADY in the bucket's 12-float layout (pos3/rot3/scale3/rgb3), so
// each group is a slice-copy, no per-object work. Material skins (shader/decal
// recipes) are a phase-2 refinement; v1 renders every row in its baked flat
// color (the rgb the row carries), which is exactly the loader's fallback when a
// face has no material ref.

import * as Geometry from '@reactjit/geometries';
import type { LoadedScene } from './decode';

// Shape ids — mirror worldGeometry.ts INSTANCE_SHAPE_* (and world_loader.zig).
const SHAPE = {
  BOX: 0, RAMP: 1, CYLINDER8: 2, CYLINDER16: 3, SPHERE: 4, GABLE: 5,
  GRASS: 6, BUSH: 7, FROND: 8, PALMTRUNK: 9, FLOWER: 10, SCENERY_BOX: 11,
  CORNER_MITER: 12, CORNER_MITER_MIRROR: 13,
  BOX_OPEN_RUN_MIN: 14, BOX_OPEN_RUN_MAX: 15, BOX_OPEN_RUN_BOTH: 16,
} as const;

const INSTANCE_FLOATS = 12; // pos3 rot3 scale3 rgb3 — what Scene3D.Instances reads

export interface RenderBucket {
  /** stable key for the React list */
  key: string;
  geometry: Geometry.GeometryDef<any>;
  params?: Record<string, unknown>;
  /** stride-12 instance data: cx,cy,cz, rotX,yaw,rotZ, sx,sy,sz, r,g,b */
  data: number[];
  count: number;
  center: [number, number, number];
  boundsRadius: number;
  /** foliage pipeline selector ('~grass~' / '~frond~'); undefined = lit flat color */
  textureKey?: string;
}

export interface BuiltScene {
  buckets: RenderBucket[];
  /** human-readable summary of what was grouped / approximated, for the load log
   *  (NO silent caps — anything not rendered faithfully is named here). */
  notes: string[];
}

type ShapePlan = {
  geometry: Geometry.GeometryDef<any>;
  params?: Record<string, unknown>;
  textureKey?: string;
  /** true when this geometry is an APPROXIMATION of the authored shape (logged). */
  approx?: boolean;
};

const UNIT_BOX_PARAMS = { width: 1, height: 1, depth: 1 };

/** Map a shape id to a geometry generator. Box-family prisms/open-runs render as
 *  full boxes in v1 (their cut faces are a visual refinement, not a load-path
 *  concern); foliage cards route to their wind pipeline via textureKey. */
function planForShape(shapeId: number): ShapePlan | null {
  switch (shapeId) {
    case SHAPE.BOX:
    case SHAPE.SCENERY_BOX:
      return { geometry: Geometry.Box, params: UNIT_BOX_PARAMS };
    case SHAPE.GABLE:
    case SHAPE.CORNER_MITER:
    case SHAPE.CORNER_MITER_MIRROR:
    case SHAPE.BOX_OPEN_RUN_MIN:
    case SHAPE.BOX_OPEN_RUN_MAX:
    case SHAPE.BOX_OPEN_RUN_BOTH:
      return { geometry: Geometry.Box, params: UNIT_BOX_PARAMS, approx: true };
    case SHAPE.RAMP:
      return { geometry: Geometry.Box, params: UNIT_BOX_PARAMS, approx: true };
    case SHAPE.CYLINDER8:
    case SHAPE.CYLINDER16:
      return { geometry: Geometry.Cylinder };
    case SHAPE.SPHERE:
      return { geometry: Geometry.Sphere };
    case SHAPE.GRASS:
      return { geometry: Geometry.GrassBlade, textureKey: '~grass~' };
    case SHAPE.BUSH:
      return { geometry: Geometry.BushClump, textureKey: '~grass~' };
    case SHAPE.FLOWER:
      return { geometry: Geometry.FlowerHead, textureKey: '~grass~' };
    case SHAPE.FROND:
      return { geometry: Geometry.Frond, textureKey: '~frond~' };
    case SHAPE.PALMTRUNK:
      return { geometry: Geometry.PalmTrunk };
    default:
      return null;
  }
}

const SHAPE_LABEL: Record<number, string> = {
  [SHAPE.RAMP]: 'ramp', [SHAPE.GABLE]: 'gable', [SHAPE.CORNER_MITER]: 'corner-miter',
  [SHAPE.CORNER_MITER_MIRROR]: 'corner-miter-mirror', [SHAPE.BOX_OPEN_RUN_MIN]: 'open-run-min',
  [SHAPE.BOX_OPEN_RUN_MAX]: 'open-run-max', [SHAPE.BOX_OPEN_RUN_BOTH]: 'open-run-both',
};

/** Group the decoded instance rows into one render bucket per shape id. The row's
 *  first 12 floats ARE the bucket's per-instance data, so a bucket is a straight
 *  copy of its rows — the cheap, flat path world_loader's batcher takes. */
export function buildSceneBuckets(scene: LoadedScene): BuiltScene {
  const stride = scene.instanceStride || INSTANCE_FLOATS;
  const insts = scene.instances;
  const count = scene.instanceCount;

  type Acc = { plan: ShapePlan; data: number[]; n: number; minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number; maxHalf: number };
  const groups = new Map<number, Acc>();
  let approxCounts = new Map<number, number>();
  let skipped = new Map<number, number>();

  for (let r = 0; r < count; r += 1) {
    const base = r * stride;
    const shapeId = stride > INSTANCE_FLOATS ? (insts[base + 12] | 0) : SHAPE.BOX;
    const plan = planForShape(shapeId);
    if (!plan) {
      skipped.set(shapeId, (skipped.get(shapeId) ?? 0) + 1);
      continue;
    }
    let acc = groups.get(shapeId);
    if (!acc) {
      acc = { plan, data: [], n: 0, minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity, maxHalf: 0 };
      groups.set(shapeId, acc);
    }
    // copy the 12-float instance row verbatim (pos/rot/scale/rgb)
    for (let i = 0; i < INSTANCE_FLOATS; i += 1) acc.data.push(insts[base + i]);
    acc.n += 1;
    const cx = insts[base + 0], cy = insts[base + 1], cz = insts[base + 2];
    const sx = insts[base + 6], sy = insts[base + 7], sz = insts[base + 8];
    if (cx < acc.minX) acc.minX = cx; if (cy < acc.minY) acc.minY = cy; if (cz < acc.minZ) acc.minZ = cz;
    if (cx > acc.maxX) acc.maxX = cx; if (cy > acc.maxY) acc.maxY = cy; if (cz > acc.maxZ) acc.maxZ = cz;
    const half = Math.max(sx, sy, sz) / 2;
    if (half > acc.maxHalf) acc.maxHalf = half;
    if (plan.approx) approxCounts.set(shapeId, (approxCounts.get(shapeId) ?? 0) + 1);
  }

  const buckets: RenderBucket[] = [];
  for (const [shapeId, acc] of groups) {
    const cx = (acc.minX + acc.maxX) / 2, cy = (acc.minY + acc.maxY) / 2, cz = (acc.minZ + acc.maxZ) / 2;
    const dx = acc.maxX - cx, dy = acc.maxY - cy, dz = acc.maxZ - cz;
    const boundsRadius = Math.sqrt(dx * dx + dy * dy + dz * dz) + acc.maxHalf;
    buckets.push({
      key: `shape:${shapeId}`,
      geometry: acc.plan.geometry,
      params: acc.plan.params,
      data: acc.data,
      count: acc.n,
      center: [cx, cy, cz],
      boundsRadius: Number.isFinite(boundsRadius) ? boundsRadius : 1,
      textureKey: acc.plan.textureKey,
    });
  }

  const notes: string[] = [];
  for (const [shapeId, n] of approxCounts) {
    notes.push(`${n} ${SHAPE_LABEL[shapeId] ?? `shape#${shapeId}`} row(s) drawn as box (cut-face geometry is a v2 refinement)`);
  }
  for (const [shapeId, n] of skipped) {
    notes.push(`${n} row(s) of unknown shape#${shapeId} skipped`);
  }
  return { buckets, notes };
}
