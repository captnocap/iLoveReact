// footprint — the EXACT measured collision footprint of a prop, derived from the
// ONE recipe source (resolvePartsForKind), so EVERY prop gets real physics, not
// just the old RECIPES kinds. Moved out of game/kinds/propModels.ts so it can
// read the resolver without an import cycle (propModels is now pure kit).

import { type PropKind } from '../../game/kinds/props';
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
