// editors/workbench/buildings/stageMath.ts — pure geometry helpers for the
// building stage. Keep these aligned with game/build/placed.ts raycastPieces:
// a clicked face and the rendered material slab must name the same slot.

import type { BuildFaceSlot } from '../../../game/build';
import type { PieceRender } from './panel';

/** quarter-turn unit normal of the piece's FRONT.
 *  Yaw uses the build-system frame: local +Z rotated by +yaw. */
export function stageQuarterNormal(yawDegrees: number): { nx: number; nz: number; odd: boolean } {
  const q = ((Math.round(yawDegrees / 90) % 4) + 4) % 4;
  if (q === 0) return { nx: 0, nz: 1, odd: false };
  if (q === 1) return { nx: -1, nz: 0, odd: true };
  if (q === 2) return { nx: 0, nz: -1, odd: false };
  return { nx: 1, nz: 0, odd: true };
}

export function isBuildPlate(kind: string): boolean {
  return kind === 'floor' || kind === 'roof' || kind === 'ramp' || kind === 'stairs';
}

export function stageFaceSlotFromNormal(p: Pick<PieceRender, 'kind' | 'yawDegrees'>, normal: { x: number; y: number; z: number }): BuildFaceSlot {
  const yawRadians = p.yawDegrees * Math.PI / 180;
  const cos = Math.cos(-yawRadians);
  const sin = Math.sin(-yawRadians);
  const lx = normal.x * cos - normal.z * sin;
  const lz = normal.x * sin + normal.z * cos;
  const ax = Math.abs(lx);
  const ay = Math.abs(normal.y);
  const az = Math.abs(lz);
  if (isBuildPlate(p.kind)) {
    if (ay >= ax && ay >= az) return normal.y >= 0 ? 'front' : 'back';
    return 'sides';
  }
  if (az >= ax && az >= ay) return lz >= 0 ? 'front' : 'back';
  return 'sides';
}
