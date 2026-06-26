// void/voidWater.ts — continuation WATER for the edge-aware void (USER req_1970).
//
// When a body of water reaches the authored map's edge, the void grows it OUT
// instead of letting it stop dead at the skybox: a small body seams into a
// RIVER that snakes away; a big one opens into a SEA (the playbook's coast).
// "size decides — small→river, big→sea" (the user's rule; the split is
// edges.SEA_SPAN_METERS).
//
// The output is ordinary parametric `WaterBody` rects — so the SAME proven water
// path renders them: live via render3d/WaterBody.tsx (the ~water~ pipeline) and
// compiled via encodeWaterBodies into the WATER lump. No new render code, no
// opaque-blue-box fake; the void's water is real water (reuse, don't reinvent).
//
// Pure + seeded (discipline #3): the river's meander is voidHash of its segment
// index, so it's identical on every pan/recompile and never Math.random.

import type { WaterBody } from '../../design';
import { voidHash } from './distortion';
import { SHELL_CHUNK_METERS } from './shell';
import type { EdgeProfile, WaterEdge } from './edges';

// A river segment is this long; the channel is a chain of them stepping outward.
const RIVER_SEGMENT_METERS = 56;
// Don't let a thin painted creek vanish — give the void river at least this
// width so it reads as water from the air.
const MIN_RIVER_WIDTH_METERS = 26;
// The channel wanders this far off the straight outward axis at most (seeded),
// so it reads as a river leaving the city, not a canal.
const RIVER_MEANDER_METERS = 70;
// How far out the continuation reaches — matched to the baked ring so the water
// fills the same horizon band the shell city does.
function reachMeters(ringChunks: number): number {
  return ringChunks * SHELL_CHUNK_METERS;
}

// A rect body from a min-corner + extents. `x,z` are the MIN corner (WaterBody
// convention: centre = x + width/2), so callers pass the corner.
function rectBody(id: string, minX: number, minZ: number, width: number, depth: number, surfaceY: number): WaterBody {
  return { id, label: 'void water', shape: 'rect', x: minX, z: minZ, width, depth, surfaceY, createdByCommand: 'void:edge-water' };
}

// One SEA: a single wide rect opening outward from the edge crossing to the
// horizon, widening past the body's own span so the far shore is out of reach —
// the forbidden crossing. Axis-aligned to the edge normal.
function seaBodies(e: WaterEdge, i: number, reach: number): WaterBody[] {
  const halfAlong = e.span / 2 + reach * 0.5; // fan out so the gap reads as open sea
  if (Math.abs(e.nx) > 0.5) {
    // Opens along ±X. Spans z about the crossing, x from the edge outward.
    const minX = e.nx > 0 ? e.x : e.x - reach;
    return [rectBody(`void_sea_${i}`, minX, e.z - halfAlong, reach, halfAlong * 2, e.surfaceY)];
  }
  const minZ = e.nz > 0 ? e.z : e.z - reach;
  return [rectBody(`void_sea_${i}`, e.x - halfAlong, minZ, halfAlong * 2, reach, e.surfaceY)];
}

// One RIVER: a chain of rect segments marching outward along the edge normal,
// each nudged laterally by a seeded meander so the channel wanders.
function riverBodies(e: WaterEdge, i: number, reach: number): WaterBody[] {
  const width = Math.max(MIN_RIVER_WIDTH_METERS, e.span);
  const steps = Math.max(1, Math.ceil(reach / RIVER_SEGMENT_METERS));
  const out: WaterBody[] = [];
  const alongX = Math.abs(e.nx) > 0.5; // channel marches along X (true) or Z
  for (let s = 0; s < steps; s += 1) {
    // Distance from the edge to this segment's near end, and its lateral wander.
    const d0 = s * RIVER_SEGMENT_METERS;
    // Seeded meander: a smooth-ish offset that grows then settles, unique per
    // segment + edge. Two octaves of voidHash keep it from looking periodic.
    const wob = (voidHash(i * 7 + s, s * 13, 3) - 0.5 + (voidHash(i, s, 9) - 0.5) * 0.5);
    const lateral = wob * RIVER_MEANDER_METERS;
    const segLen = Math.min(RIVER_SEGMENT_METERS, reach - d0) + 2; // +2 overlap, no seams
    if (alongX) {
      const nearX = e.nx > 0 ? e.x + d0 : e.x - d0 - segLen;
      out.push(rectBody(`void_river_${i}_${s}`, nearX, e.z + lateral - width / 2, segLen, width, e.surfaceY));
    } else {
      const nearZ = e.nz > 0 ? e.z + d0 : e.z - d0 - segLen;
      out.push(rectBody(`void_river_${i}_${s}`, e.x + lateral - width / 2, nearZ, width, segLen, e.surfaceY));
    }
  }
  return out;
}

// Every edge-water feature → its continuation bodies. `ringChunks` matches the
// shell's baked ring depth so water and city fill the same horizon.
export function buildVoidWaterBodies(profile: EdgeProfile, ringChunks: number): WaterBody[] {
  const reach = reachMeters(ringChunks);
  const out: WaterBody[] = [];
  profile.waterEdges.forEach((e, i) => {
    out.push(...(e.sea ? seaBodies(e, i, reach) : riverBodies(e, i, reach)));
  });
  return out;
}

// Axis-aligned footprints of the void water, for the shell to suppress buildings
// (and the street-cross) where water now sits — so towers don't sprout mid-river.
export function voidWaterFootprints(bodies: readonly WaterBody[]): { minX: number; minZ: number; maxX: number; maxZ: number }[] {
  return bodies.map((b) => ({ minX: b.x, minZ: b.z, maxX: b.x + b.width, maxZ: b.z + b.depth }));
}
