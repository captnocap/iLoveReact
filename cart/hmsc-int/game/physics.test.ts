// physics.test.ts — P4 behavior tests for GAME_PHYSICS.
//
// The real host is Zig; here a scripted fake implements a tiny, readable slice
// of the same wire contract (gravity integration + echo), so the tests assert
// BEHAVIOR — "step a falling player and get the fallen player back", "missing
// host degrades to null", "over-cap input is rejected at the boundary" — not
// function names. The slot layout the fake reads is the same one
// cart/hmsc/state/hostPhysics.ts ships over today (the behavior reference).

import { GAME_PHYSICS, PHYSICS_LIMITS, type PhysicsBody, type PhysicsStepInput } from './physics';
import { assert, assertClose, assertEqual, assertThrows, finish, test } from './_testkit';

declare const globalThis: any;

const TUNING = {
  gravityMetersPerSecondSquared: 10,
  jumpSpeedMetersPerSecond: 5,
  playerCapsuleRadiusMeters: 0.35,
  playerCapsuleHeightMeters: 1.65,
  wallRestitution: 0.1,
  bodyRestitution: 0.4,
  playerStepHeightMeters: 0.4,
};

const SURFACE = { accelerationMultiplier: 1, friction: 0.2, restitution: 0.8 };

function stepInput(overrides: Partial<PhysicsStepInput> = {}): PhysicsStepInput {
  return {
    dtSeconds: 0.1,
    intentX: 0,
    intentZ: 0,
    speedMetersPerSecond: 4,
    jumpDown: false,
    player: {
      position: { x: 1, y: 10, z: 2 },
      velocity: { x: 0, y: 0, z: 0 },
      yawDegrees: 90,
    },
    surface: SURFACE,
    tuning: TUNING,
    ...overrides,
  };
}

/** Fake host: applies gravity to the player + every body, echoes the rest.
 *  Reads the SAME slots the Zig host reads; records the wire for inspection. */
let lastWire: Float32Array | null = null;
function installFakeHost(): void {
  globalThis.__game_physics_step = (wire: Float32Array): ArrayBuffer => {
    lastWire = wire;
    const dt = wire[0];
    const gravity = wire[14];
    const bodyCount = wire[12] | 0;
    const out = new Float32Array(9 + bodyCount * 8);
    out[0] = 123; // hostUs
    const vy = wire[9] - gravity * dt;
    out[1] = wire[5];
    out[2] = wire[6] + vy * dt;
    out[3] = wire[7];
    out[4] = wire[8];
    out[5] = vy;
    out[6] = wire[10];
    out[7] = 0; // airborne
    out[8] = bodyCount;
    let read = 25;
    let write = 9;
    for (let i = 0; i < bodyCount; i += 1) {
      const bvy = wire[read + 4] - gravity * dt;
      out[write++] = wire[read + 0];
      out[write++] = wire[read + 1] + bvy * dt;
      out[write++] = wire[read + 2];
      out[write++] = wire[read + 3];
      out[write++] = bvy;
      out[write++] = wire[read + 5];
      out[write++] = wire[read + 6];
      out[write++] = 1; // grounded
      read += 8;
    }
    return out.buffer;
  };
}

function removeFakeHost(): void {
  delete globalThis.__game_physics_step;
  delete globalThis.__game_physics_register_heightfield;
  delete globalThis.__game_physics_clear_heightfields;
}

test('a missing host degrades to null, never throws', () => {
  removeFakeHost();
  assertEqual(GAME_PHYSICS.hostReady(), false, 'hostReady must be false without bindings');
  assertEqual(GAME_PHYSICS.step(stepInput()), null, 'step must return null without bindings');
  GAME_PHYSICS.registerHeightfield({
    slot: 0, originX: 0, originZ: 0, cellSizeMeters: 1, cols: 2, rows: 2,
    baseY: 0, walkableSlopeCos: 0.7, heights: new Float32Array(4),
  });
  GAME_PHYSICS.clearHeightfields();
});

test('a falling player steps under gravity and comes back typed', () => {
  installFakeHost();
  assertEqual(GAME_PHYSICS.hostReady(), true, 'hostReady must be true with bindings');
  const result = GAME_PHYSICS.step(stepInput());
  assert(result !== null, 'step must return a result with a live host');
  const expectedVy = -TUNING.gravityMetersPerSecondSquared * 0.1;
  assertClose(result!.player.velocity.y, expectedVy, 1e-5, 'gravity must apply to the player');
  assertClose(result!.player.position.y, 10 + expectedVy * 0.1, 1e-5, 'the player must fall');
  assertEqual(result!.player.grounded, false, 'airborne player must come back ungrounded');
  assertClose(result!.hostMicroseconds, 123, 1e-5, 'host telemetry must round-trip');
});

test('bodies ride the same step and come back grounded + typed', () => {
  installFakeHost();
  const body: PhysicsBody = {
    position: { x: 5, y: 3, z: 6 },
    velocity: { x: 1, y: 0, z: -1 },
    radiusMeters: 0.5,
    restitution: 0.4,
  };
  const result = GAME_PHYSICS.step(stepInput({ bodies: [body] }));
  assert(result !== null, 'step must return a result');
  assertEqual(result!.bodies.length, 1, 'one body in, one body out');
  const stepped = result!.bodies[0];
  assertClose(stepped.velocity.y, -1, 1e-5, 'gravity must apply to the body');
  assertClose(stepped.position.y, 3 - 0.1, 1e-5, 'the body must fall');
  assertEqual(stepped.grounded, true, 'fake host grounds bodies');
  assertClose(stepped.radiusMeters, 0.5, 1e-5, 'body radius must round-trip');
});

test('tuning, surface, and solids arrive on the wire the host reads', () => {
  installFakeHost();
  GAME_PHYSICS.step(stepInput({
    rects: [{ minX: 0, minZ: 0, maxX: 2, maxZ: 2, topMeters: 1, blocksPlayer: true, friction: 0.3, restitution: 0.5 }],
    orientedRects: [{
      minX: 4, minZ: 4, maxX: 6, maxZ: 6, topMeters: 2, blocksPlayer: true,
      friction: 0.3, restitution: 0.5, floorMeters: 1.5, pivotX: 5, pivotZ: 5, yawRadians: 0.7,
    }],
  }));
  const wire = lastWire!;
  assertClose(wire[14], TUNING.gravityMetersPerSecondSquared, 1e-5, 'gravity slot');
  assertClose(wire[17], TUNING.playerCapsuleHeightMeters, 1e-5, 'capsule height slot');
  assertClose(wire[22], SURFACE.friction, 1e-5, 'surface friction slot');
  assertEqual(wire[13], 1, 'rect count slot');
  assertEqual(wire[24], 1, 'oriented count slot');
  const rectAt = 25; // no bodies in this step
  assert(wire[rectAt + 8] < -1e8, 'rect without floorMeters must be solid-to-the-ground');
  const orientedAt = rectAt + 9;
  assertClose(wire[orientedAt + 8], 1.5, 1e-5, 'oriented rect floor must carry through');
  assertClose(wire[orientedAt + 11], 0.7, 1e-5, 'oriented rect yaw must carry through');
});

test('over-cap input is rejected at the boundary, not silently truncated', () => {
  installFakeHost();
  const body: PhysicsBody = {
    position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, radiusMeters: 0.5, restitution: 0,
  };
  const bodies = new Array(PHYSICS_LIMITS.bodies + 1).fill(body);
  assertThrows(() => GAME_PHYSICS.step(stepInput({ bodies })), 'over-cap bodies must throw');
});

test('heightfields register with the slot/grid/rotation the host expects', () => {
  const calls: any[][] = [];
  globalThis.__game_physics_register_heightfield = (...args: any[]) => calls.push(args);
  globalThis.__game_physics_clear_heightfields = () => calls.push(['clear']);
  const heights = new Float32Array([0, 1, 2, 3]);
  GAME_PHYSICS.registerHeightfield({
    slot: 3, originX: 10, originZ: 20, cellSizeMeters: 2, cols: 2, rows: 2,
    baseY: 1, walkableSlopeCos: 0.71, heights, yawRadians: 0.5, pivotX: 11, pivotZ: 21,
  });
  GAME_PHYSICS.clearHeightfields();
  assertEqual(calls.length, 2, 'register + clear must each reach the host');
  const [slot, ox, oz, cell, cols, rows, baseY, walkCos, grid, yaw, px, pz] = calls[0];
  assertEqual(slot, 3, 'slot');
  assertClose(ox, 10, 1e-9, 'originX');
  assertClose(oz, 20, 1e-9, 'originZ');
  assertClose(cell, 2, 1e-9, 'cell size');
  assertEqual(cols, 2, 'cols');
  assertEqual(rows, 2, 'rows');
  assertClose(baseY, 1, 1e-9, 'baseY');
  assertClose(walkCos, 0.71, 1e-9, 'walkable slope cos');
  assertEqual(grid, heights, 'heights grid must pass through untouched');
  assertClose(yaw, 0.5, 1e-9, 'yaw');
  assertClose(px, 11, 1e-9, 'pivotX');
  assertClose(pz, 21, 1e-9, 'pivotZ');
  assertEqual(calls[1][0], 'clear', 'clear must reach the host');
  removeFakeHost();
});

finish('game/physics');
