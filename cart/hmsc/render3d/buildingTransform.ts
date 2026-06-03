// Shared yaw transform for box-building meshes. A building is authored
// axis-aligned (footprint min-corner + width/depth); `yawDegrees` then spins the
// whole mass about its footprint centre. Wall/window/door meshes are sculpted in
// world-axis space, so each part's world position is rotated about the centre and
// the mesh itself carries rotation={[0, yawDegrees, 0]} — the SAME pairing props
// use (world/render3d/props/place.ts rotateYaw + per-mesh Y-rotation), so the
// offset rotation matches the engine's mesh rotation exactly.
//
// Collision uses the inverse of this same transform in the host (the oriented
// rects in state/hostPhysics.ts → v8_bindings_physics_lab.zig), so the wall you
// see is the wall you hit at any angle. Open structures (parking garage / gas
// station / lot) draw their own multi-mesh models and stay axis-aligned for now;
// they ignore yaw in both render and collision so see==walk holds for them too.

import type { Building } from '../design';

export function buildingYawDegrees(b: Building): number {
  return b.yawDegrees ?? 0;
}

export function buildingCenterXZ(b: Building): { x: number; z: number } {
  return { x: b.x + b.widthTiles / 2, z: b.z + b.depthTiles / 2 };
}

// Rotate a world XZ point about the building centre by its yaw. Matches
// place.ts rotateYaw applied to the offset from centre (local→world), so a mesh
// placed here and given rotation={[0, yawDegrees, 0]} lands oriented correctly.
export function yawAboutCenter(b: Building, x: number, z: number): [number, number] {
  const yaw = (b.yawDegrees ?? 0) * Math.PI / 180;
  if (yaw === 0) return [x, z];
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const cx = b.x + b.widthTiles / 2;
  const cz = b.z + b.depthTiles / 2;
  const dx = x - cx;
  const dz = z - cz;
  return [cx + dx * c + dz * s, cz - dx * s + dz * c];
}

// Place a structure-model mesh part: rotate its world (x,z) anchor about the
// building centre, keep y. Pair with rotation={[0, buildingYawDegrees(b), 0]} so
// an axis-aligned box part both moves AND spins with the building. This is what
// lets the open structures (garage/gas/lot/drive-in) rotate uniformly with the
// box buildings — every placed thing is just a building.
export function buildingPart(b: Building, x: number, y: number, z: number): [number, number, number] {
  const [wx, wz] = yawAboutCenter(b, x, z);
  return [wx, y, wz];
}

// Rotate a sub-model anchored by {x,z,yawDegrees} (a parked Car, a fuel Pump) WITH
// its building: spin its anchor about the building centre and fold the building's
// yaw into its own facing. The sub-model already rotates itself by yawDegrees
// (place.ts rotateYaw), so a rotated copy renders correctly with no model change.
export function yawAnchored<T extends { x: number; z: number; yawDegrees: number }>(b: Building, item: T): T {
  const [x, z] = yawAboutCenter(b, item.x, item.z);
  return { ...item, x, z, yawDegrees: item.yawDegrees + buildingYawDegrees(b) };
}
