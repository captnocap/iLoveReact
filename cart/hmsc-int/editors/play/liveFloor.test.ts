// liveFloor.test.ts — consumption-layer guards for the shared embodied player
// substrate. The live-floor watchdog may recover a bad pose, but it must not
// re-register heightfields during steady play or when the host table is already
// intact.

import { liveFloorRecoveryDecision, type LiveFloorPlayerPose } from '../../embodiedLiveFloor';
import { assertEqual, finish, test } from '../../game/_testkit';
import type { Heightfield, PhysicsTuning } from '../../game';

declare const globalThis: any;

const TUNING: PhysicsTuning = {
  gravityMetersPerSecondSquared: 10,
  jumpSpeedMetersPerSecond: 5,
  playerCapsuleRadiusMeters: 0.35,
  playerCapsuleHeightMeters: 1.65,
  wallRestitution: 0.1,
  bodyRestitution: 0.4,
  playerStepHeightMeters: 0.4,
  walkableRectSidePushGraceMeters: 0.08,
};

const FIELD: Heightfield = {
  slot: 0,
  originX: 0,
  originZ: 0,
  cellSizeMeters: 1,
  cols: 4,
  rows: 4,
  baseY: 0,
  walkableSlopeCos: 0.7,
  heights: new Float32Array(16),
};

function pose(y: number): LiveFloorPlayerPose {
  return { x: 1, y, z: 1, yaw: 0 };
}

function installHeightfieldProbeHost(registered: boolean): { registerCalls: () => number; restore: () => void } {
  const prevStep = globalThis.__game_physics_step;
  const prevRegister = globalThis.__game_physics_register_heightfield;
  let registerCalls = 0;
  globalThis.__game_physics_register_heightfield = () => {
    registerCalls += 1;
  };
  globalThis.__game_physics_step = (wire: Float32Array): ArrayBuffer => {
    const dt = wire[0];
    const gravity = wire[14];
    const out = new Float32Array(9);
    out[1] = wire[5];
    out[3] = wire[7];
    if (registered) {
      out[2] = 0;
      out[5] = 0;
      out[7] = 1;
    } else {
      const vy = wire[9] - gravity * dt;
      out[2] = wire[6] + vy * dt;
      out[5] = vy;
      out[7] = 0;
    }
    return out.buffer;
  };
  return {
    registerCalls: () => registerCalls,
    restore: () => {
      if (prevStep) globalThis.__game_physics_step = prevStep;
      else delete globalThis.__game_physics_step;
      if (prevRegister) globalThis.__game_physics_register_heightfield = prevRegister;
      else delete globalThis.__game_physics_register_heightfield;
    },
  };
}

test('REQ-0111: steady idle never asks the live-floor watchdog to register heightfields', () => {
  const host = installHeightfieldProbeHost(true);
  try {
    for (let frame = 0; frame < 5; frame += 1) {
      const decision = liveFloorRecoveryDecision({
        authoredGroundExists: true,
        player: pose(0),
        columnTop: 0,
        capsuleHeightMeters: TUNING.playerCapsuleHeightMeters,
        tuning: TUNING,
        heightfields: [FIELD],
      });
      assertEqual(decision.shouldRecover, false, `idle frame ${frame} does not recover`);
      assertEqual(decision.shouldRegister, false, `idle frame ${frame} does not register`);
      assertEqual(decision.reason, 'player-above-recovery-threshold', `idle frame ${frame} reason`);
    }
    assertEqual(host.registerCalls(), 0, 'idle frames produce zero heightfield register calls');
  } finally {
    host.restore();
  }
});

test('REQ-0111: recovery no-ops registration when the host heightfield is already present', () => {
  const host = installHeightfieldProbeHost(true);
  try {
    for (let frame = 0; frame < 5; frame += 1) {
      const decision = liveFloorRecoveryDecision({
        authoredGroundExists: true,
        player: pose(-2),
        columnTop: 0,
        capsuleHeightMeters: TUNING.playerCapsuleHeightMeters,
        tuning: TUNING,
        heightfields: [FIELD],
      });
      assertEqual(decision.shouldRecover, true, `recovery frame ${frame} still snaps the bad pose`);
      assertEqual(decision.shouldRegister, false, `recovery frame ${frame} does not register`);
      assertEqual(decision.reason, 'heightfield-present', `recovery frame ${frame} reason`);
    }
    assertEqual(host.registerCalls(), 0, 'present host table produces zero heightfield register calls');
  } finally {
    host.restore();
  }
});

test('REQ-0111: recovery requests sync only when the host probe shows the heightfield is missing', () => {
  const host = installHeightfieldProbeHost(false);
  try {
    const decision = liveFloorRecoveryDecision({
      authoredGroundExists: true,
      player: pose(-2),
      columnTop: 0,
      capsuleHeightMeters: TUNING.playerCapsuleHeightMeters,
      tuning: TUNING,
      heightfields: [FIELD],
    });
    assertEqual(decision.shouldRecover, true, 'bad pose still recovers');
    assertEqual(decision.shouldRegister, true, 'missing host table requests one gated sync');
    assertEqual(decision.reason, 'heightfield-missing', 'missing-table reason is logged');
    assertEqual(host.registerCalls(), 0, 'decision only reports the need; the caller owns the actual sync');
  } finally {
    host.restore();
  }
});

finish('editors/play/live-floor');
