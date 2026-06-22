// footprint — the EXACT measured collision footprint of a prop, derived from the
// ONE recipe source (resolvePartsForKind), so EVERY prop gets real physics, not
// just the old RECIPES kinds. Moved out of game/kinds/propModels.ts so it can
// read the resolver without an import cycle (propModels is now pure kit).

import { type PropCollisionBox, type PropKind } from '../../game/kinds/props';
import { HMSC_SCALE } from '../../world/scale';
import { resolvePartsForKind } from './resolve';

const FOOTPRINT_DEG = Math.PI / 180;

// A walking player only collides with what stands in its own height band — the
// canopy 5m up, the blade sign overhead, a high shelf's top are visual, not
// blockers. The band is the player capsule height (HMSC_SCALE, the one source),
// measured up from the prop's ground anchor; parts entirely above it don't widen
// the footprint into a phantom ground wall (PROPFOOT-0759: a derived appleTree
// was a 5m collision blob from its canopy until this gate).
const FOOTPRINT_BAND_METERS = HMSC_SCALE.playerCapsuleHeightMeters;

// One local point spun by a part's own Euler rotation (degrees), Rz·Ry·Rx — the
// SAME order the renderer composes before the prop's yaw. Used to find the true
// XZ extent (and Y, to test the band) of a tilted part (the A-frame's ±12°
// boards, a leaning blade).
function rotatePartPoint(x: number, y: number, z: number, rx: number, ry: number, rz: number): { x: number; y: number; z: number } {
  const cx = Math.cos(rx * FOOTPRINT_DEG), sx = Math.sin(rx * FOOTPRINT_DEG);
  const y1 = y * cx - z * sx, z1 = y * sx + z * cx;
  const cy = Math.cos(ry * FOOTPRINT_DEG), sy = Math.sin(ry * FOOTPRINT_DEG);
  const x2 = x * cy + z1 * sy, z2 = -x * sy + z1 * cy;
  const cz = Math.cos(rz * FOOTPRINT_DEG), sz = Math.sin(rz * FOOTPRINT_DEG);
  const x3 = x2 * cz - y1 * sz, y3 = x2 * sz + y1 * cz;
  return { x: x3, y: y3, z: z2 };
}

/** The EXACT measured footprint of a prop. */
export type PropModelFootprint = {
  /** local-X span of the in-band model mass, meters */
  widthMeters: number;
  /** local-Z span, meters */
  depthMeters: number;
  /** the model's XZ center in its OWN (un-yawed) local frame — nonzero when the
   *  mass is authored off the placement anchor. Consumers rotate this by the
   *  prop's yaw so the footprint tracks the mesh at any rotation (FOOTPRINT-0765). */
  offsetXMeters: number;
  offsetZMeters: number;
  /** the model reads ROUND in plan (cylinder/sphere mass dominates and width ≈
   *  depth) — collision should be a CIRCLE of radius max(width,depth)/2, not a
   *  square that overhangs the corners (a fountain, barrel, drum). */
  round: boolean;
};

/** FOOTPRINT-0759/0765: the EXACT collision footprint of a prop, measured from
 *  the model itself — the XZ bounding box over the parts that stand in the
 *  player's walking band (see FOOTPRINT_BAND_METERS), so the player bumps
 *  precisely what they see at body height, with no hand-tuned number to drift.
 *  Carries the model's center OFFSET (so an off-center body tracks under rotation)
 *  and a ROUND flag (so a circular base collides as a circle, not a square).
 *  Returns null for props whose mass is ALL overhead (a hanging blade sign), so
 *  those fall back to the kind's footprintRadius square. A cylinder's size is
 *  [diameter, h, diameter], so its corner box IS its circular footprint's AABB. */
export function propModelFootprintMeters(kind: PropKind): PropModelFootprint | null {
  const parts = resolvePartsForKind(kind);
  if (!parts || parts.length === 0) return null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  let roundVolume = 0, boxVolume = 0;
  let inBand = false;
  for (const part of parts) {
    const hx = part.size[0] / 2, hy = part.size[1] / 2, hz = part.size[2] / 2;
    const rx = part.rotation?.[0] ?? 0, ry = part.rotation?.[1] ?? 0, rz = part.rotation?.[2] ?? 0;
    let partMinY = Infinity, partMaxY = -Infinity;
    let pMinX = Infinity, pMaxX = -Infinity, pMinZ = Infinity, pMaxZ = -Infinity;
    for (const ax of [-1, 1] as const) {
      for (const ay of [-1, 1] as const) {
        for (const az of [-1, 1] as const) {
          const r = rotatePartPoint(ax * hx, ay * hy, az * hz, rx, ry, rz);
          const py = part.local[1] + r.y;
          if (py < partMinY) partMinY = py;
          if (py > partMaxY) partMaxY = py;
          const wx = part.local[0] + r.x;
          const wz = part.local[2] + r.z;
          if (wx < pMinX) pMinX = wx;
          if (wx > pMaxX) pMaxX = wx;
          if (wz < pMinZ) pMinZ = wz;
          if (wz > pMaxZ) pMaxZ = wz;
        }
      }
    }
    // Skip parts that float entirely above the player (canopy, hanging sign) or
    // below the ground anchor — they are not what a walking body runs into.
    if (partMaxY < 0 || partMinY > FOOTPRINT_BAND_METERS) continue;
    inBand = true;
    if (pMinX < minX) minX = pMinX;
    if (pMaxX > maxX) maxX = pMaxX;
    if (pMinZ < minZ) minZ = pMinZ;
    if (pMaxZ > maxZ) maxZ = pMaxZ;
    const volume = part.size[0] * part.size[1] * part.size[2];
    if (part.shape === 'box') boxVolume += volume; else roundVolume += volume;
  }
  if (!inBand) return null;
  const widthMeters = maxX - minX;
  const depthMeters = maxZ - minZ;
  // Round only when the plan is near-square (a tall cylinder), so a long oval
  // cylinder (a pipe on its side) stays a rect, not a misfit circle.
  const round = roundVolume > boxVolume
    && Math.abs(widthMeters - depthMeters) < 0.15 * Math.max(widthMeters, depthMeters);
  return {
    widthMeters,
    depthMeters,
    offsetXMeters: (minX + maxX) / 2,
    offsetZMeters: (minZ + maxZ) / 2,
    round,
  };
}

/** The local-space AABB of ONE recipe part, its own Euler rotation baked in (the
 *  SAME 8-corner spin propModelFootprintMeters measures the footprint with). */
function partLocalBox(part: ReturnType<typeof resolvePartsForKind>[number]): PropCollisionBox {
  const hx = part.size[0] / 2, hy = part.size[1] / 2, hz = part.size[2] / 2;
  const rx = part.rotation?.[0] ?? 0, ry = part.rotation?.[1] ?? 0, rz = part.rotation?.[2] ?? 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const ax of [-1, 1] as const) {
    for (const ay of [-1, 1] as const) {
      for (const az of [-1, 1] as const) {
        const r = rotatePartPoint(ax * hx, ay * hy, az * hz, rx, ry, rz);
        const x = part.local[0] + r.x, y = part.local[1] + r.y, z = part.local[2] + r.z;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
    }
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

/** Do two boxes overlap in plan (XZ), padded by eps so abutting parts count as
 *  connected? Used to cluster the in-band parts a body actually runs into. */
function xzOverlap(a: PropCollisionBox, b: PropCollisionBox, eps: number): boolean {
  return a.minX - eps <= b.maxX && b.minX - eps <= a.maxX
    && a.minZ - eps <= b.maxZ && b.minZ - eps <= a.maxZ;
}

/** SHAPE-AWARE prop collision (req_1587, extended to data-recipe props): one box
 *  PER recipe part, in prop-local meters — the SAME thing the cooked-asset path
 *  derives from authored parts (collisionBoxesFromParts). A walk-under prop (a
 *  big sign / archway: two edge posts carrying an overhead board) collides as its
 *  posts plus a high banded board box, so the gap between the posts stays open —
 *  instead of the single footprint AABB that spans post-to-post and walls you out
 *  at ground level (the "can't walk under the big sign" bug). Each box keeps its
 *  own vertical band, so placedPieceColliders bands the overhead board high and the
 *  player passes beneath it.
 *
 *  GATED narrowly to the shape that actually breaks: the in-band parts (the ones a
 *  walking body touches) must form TWO OR MORE separated XZ clusters — the legs of
 *  an archway / the posts of a sign — whose single AABB would wall in the gap
 *  between them. A prop with ONE in-band cluster (a tree's trunk, a single pole, a
 *  barrel) has no gap to fill, so it returns null and keeps its exact measured
 *  footprint untouched — the round-circle/offset treatment and every compact and
 *  single-stem prop's collision are unchanged. */
export function propCollisionBoxes(kind: PropKind): PropCollisionBox[] | null {
  const parts = resolvePartsForKind(kind);
  if (!parts || parts.length === 0) return null;
  const boxes = parts.map(partLocalBox).filter((b) => b.maxY > 0); // drop buried base parts
  if (boxes.length === 0) return null;
  // The parts a walking body runs into: spanning the ground→band slab in Y.
  const inBand = boxes.filter((b) => b.minY < FOOTPRINT_BAND_METERS);
  if (inBand.length < 2) return null; // single stem / compact → no gap, keep footprint
  // Cluster the in-band parts by XZ adjacency (union–find). 2+ clusters = the
  // post-and-gap shape; one merged cluster = a solid base with no walk-under gap.
  const eps = 0.05;
  const parent = inBand.map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < inBand.length; i++) {
    for (let j = i + 1; j < inBand.length; j++) {
      if (xzOverlap(inBand[i], inBand[j], eps)) parent[find(i)] = find(j);
    }
  }
  const clusters = new Set(inBand.map((_, i) => find(i)));
  if (clusters.size < 2) return null;
  // Per-part boxes: the posts block at their own band, the overhead board bands
  // high (walk-under). Mirrors the cooked-asset collisionBoxes shape.
  return boxes;
}
