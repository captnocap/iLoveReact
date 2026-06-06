// embodiedLiveFloor.ts — pure live-floor recovery decision used by the shared
// embodied player hook and its consumption-layer witness tests.

import { GAME_PHYSICS } from '@game';
import type { Heightfield, PhysicsTuning } from '@game';

export const LIVE_FLOOR_PROBE = { maxRecoveryLogs: 8, probeDtSeconds: 0.016, probeToleranceMeters: 0.02 } as const;
const LIVE_FLOOR_SURFACE = { accelerationMultiplier: 1, friction: 0.2, restitution: 0 } as const;

export type LiveFloorPlayerPose = {
  x: number;
  y: number;
  z: number;
  yaw: number;
};

function heightfieldLocalPoint(field: Heightfield, x: number, z: number): { x: number; z: number } {
  if (field.yawRadians == null || field.yawRadians === 0) return { x, z };
  const pivotX = field.pivotX ?? 0;
  const pivotZ = field.pivotZ ?? 0;
  const dx = x - pivotX;
  const dz = z - pivotZ;
  const c = Math.cos(-field.yawRadians);
  const s = Math.sin(-field.yawRadians);
  return {
    x: pivotX + dx * c - dz * s,
    z: pivotZ + dx * s + dz * c,
  };
}

function heightfieldCovers(field: Heightfield, x: number, z: number): boolean {
  const p = heightfieldLocalPoint(field, x, z);
  const maxX = field.originX + field.cellSizeMeters * (field.cols - 1);
  const maxZ = field.originZ + field.cellSizeMeters * (field.rows - 1);
  const eps = 1e-6;
  return p.x >= field.originX - eps && p.x <= maxX + eps && p.z >= field.originZ - eps && p.z <= maxZ + eps;
}

export type LiveFloorRecoveryDecision = {
  shouldRecover: boolean;
  shouldRegister: boolean;
  reason: string;
  authoredGroundExists: boolean;
  hostReady: boolean;
  fieldCount: number;
  fieldUnderPlayer: boolean;
  recoveryThresholdY: number;
  columnTop: number;
  playerY: number;
  probeY: number | null;
  probeGrounded: boolean | null;
};

export function liveFloorRecoveryDecision(args: {
  authoredGroundExists: boolean;
  player: LiveFloorPlayerPose;
  columnTop: number;
  capsuleHeightMeters: number;
  tuning: PhysicsTuning;
  heightfields: readonly Heightfield[];
}): LiveFloorRecoveryDecision {
  const recoveryThresholdY = args.columnTop - args.capsuleHeightMeters;
  const idleBase = {
    authoredGroundExists: args.authoredGroundExists,
    hostReady: false,
    fieldCount: args.heightfields.length,
    fieldUnderPlayer: false,
    recoveryThresholdY,
    columnTop: args.columnTop,
    playerY: args.player.y,
    probeY: null,
    probeGrounded: null,
  };
  if (!args.authoredGroundExists) return { ...idleBase, shouldRecover: false, shouldRegister: false, reason: 'no-authored-ground' };
  if (args.player.y >= recoveryThresholdY) {
    return { ...idleBase, shouldRecover: false, shouldRegister: false, reason: 'player-above-recovery-threshold' };
  }
  const fieldUnderPlayer = args.heightfields.some((field) => heightfieldCovers(field, args.player.x, args.player.z));
  const hostReady = fieldUnderPlayer ? GAME_PHYSICS.hostReady() : false;
  const base = { ...idleBase, hostReady, fieldUnderPlayer };
  if (!base.fieldUnderPlayer) {
    return { ...base, shouldRecover: true, shouldRegister: false, reason: 'no-heightfield-under-player' };
  }
  if (!base.hostReady) return { ...base, shouldRecover: true, shouldRegister: false, reason: 'host-unavailable' };

  const probe = GAME_PHYSICS.step({
    dtSeconds: LIVE_FLOOR_PROBE.probeDtSeconds,
    intentX: 0,
    intentZ: 0,
    speedMetersPerSecond: 0,
    jumpDown: false,
    player: {
      position: { x: args.player.x, y: args.columnTop, z: args.player.z },
      velocity: { x: 0, y: 0, z: 0 },
      yawDegrees: args.player.yaw,
    },
    surface: LIVE_FLOOR_SURFACE,
    tuning: args.tuning,
    rects: [],
    orientedRects: [],
  });
  if (!probe) return { ...base, shouldRecover: true, shouldRegister: false, reason: 'probe-unavailable' };
  const probeY = probe.player.position.y;
  const probeGrounded = probe.player.grounded;
  const present = probeGrounded && probeY >= args.columnTop - LIVE_FLOOR_PROBE.probeToleranceMeters;
  return {
    ...base,
    probeY,
    probeGrounded,
    shouldRecover: true,
    shouldRegister: !present,
    reason: present ? 'heightfield-present' : 'heightfield-missing',
  };
}
