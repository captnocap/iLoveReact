// Axis-aligned XZ rectangle math — the one home for footprint overlap/gap so the
// building placement policy, the prop spacing checks, and the placement validator
// don't each grow their own copy (they did: buildingPlacement.ts had private
// rectsOverlap/rectGap). A BuildingFootprint, PropFootprint, and RoadFootprint are
// all structurally this Rect, so every layer's footprint flows through here.
// 1 tile = 1 meter.

export type Rect = { minX: number; minZ: number; maxX: number; maxZ: number };

// Strict overlap: shared edges (a.maxX === b.minX) do NOT count, so two things may
// sit flush against each other but not interpenetrate.
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

// Edge-to-edge gap between two rects: 0 if they touch/overlap, else the nearest
// corner/edge distance in meters.
export function rectGap(a: Rect, b: Rect): number {
  const dx = Math.max(b.minX - a.maxX, a.minX - b.maxX, 0);
  const dz = Math.max(b.minZ - a.maxZ, a.minZ - b.maxZ, 0);
  return Math.hypot(dx, dz);
}

export function rectCenter(r: Rect): { x: number; z: number } {
  return { x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 };
}
