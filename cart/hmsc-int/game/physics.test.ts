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
import { catalogEntry } from './build/catalog';
import { placedPieceColliders, placedPieceRamps, type PlacedBuildPiece } from './build/placed';

declare const globalThis: any;

const TUNING = {
  gravityMetersPerSecondSquared: 10,
  jumpSpeedMetersPerSecond: 5,
  playerCapsuleRadiusMeters: 0.35,
  playerCapsuleHeightMeters: 1.65,
  wallRestitution: 0.1,
  bodyRestitution: 0.4,
  playerStepHeightMeters: 0.4,
  walkableRectSidePushGraceMeters: 0.08,
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

let nextPlacedId = 0;
function buildPiece(pieceId: string, x: number, z: number, over: Partial<PlacedBuildPiece> = {}): PlacedBuildPiece {
  nextPlacedId += 1;
  return { id: `p_${nextPlacedId}`, pieceId, x, y: 0, z, yawDegrees: 0, ...over };
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
  assertClose(wire[11], TUNING.walkableRectSidePushGraceMeters, 1e-5, 'walkable rect grace slot');
  const rectAt = 25; // no bodies in this step
  assert(wire[rectAt + 8] < -1e8, 'rect without floorMeters must be solid-to-the-ground');
  const orientedAt = rectAt + 9;
  assertClose(wire[orientedAt + 8], 1.5, 1e-5, 'oriented rect floor must carry through');
  assertClose(wire[orientedAt + 11], 0.7, 1e-5, 'oriented rect yaw must carry through');
});

function installFloorEdgeHost(): void {
  globalThis.__game_physics_step = (wire: Float32Array): ArrayBuffer => {
    lastWire = wire;
    const dt = wire[0];
    const radius = wire[16];
    const height = wire[17];
    const stepHeight = wire[20];
    const grace = wire[11];
    const rectCount = wire[13] | 0;
    let x = wire[5] + wire[8] * dt;
    let y = wire[6] + (wire[9] - wire[14] * dt) * dt;
    const z = wire[7] + wire[10] * dt;
    let vx = wire[8];
    let vy = wire[9] - wire[14] * dt;
    let vz = wire[10];
    let ground = -1000000;
    let at = 25;
    for (let i = 0; i < rectCount; i += 1) {
      const minX = wire[at], minZ = wire[at + 1], maxX = wire[at + 2], maxZ = wire[at + 3];
      const top = wire[at + 4], solid = wire[at + 5] > 0.5, floor = wire[at + 8];
      if (x >= minX && x <= maxX && z >= minZ && z <= maxZ && top <= y + stepHeight) ground = Math.max(ground, top);
      const reachable = top <= y + stepHeight && y >= floor - grace;
      const belowBand = y + height <= floor;
      if (solid && !reachable && !belowBand && y < top - 0.04) {
        const closestX = Math.max(minX, Math.min(maxX, x));
        const closestZ = Math.max(minZ, Math.min(maxZ, z));
        const dx = x - closestX;
        const dz = z - closestZ;
        const d = Math.hypot(dx, dz);
        if (d < radius && d > 1e-6) {
          const nx = dx / d;
          const nz = dz / d;
          x += nx * (radius - d);
          vx = Math.max(0, vx * nx) === 0 ? 0 : vx;
          vz = Math.max(0, vz * nz) === 0 ? 0 : vz;
        }
      }
      at += 9;
    }
    if (y <= ground) {
      y = ground;
      if (vy < 0) vy = 0;
    }
    const out = new Float32Array(9);
    out[1] = x; out[2] = y; out[3] = z;
    out[4] = vx; out[5] = vy; out[6] = vz;
    out[7] = y === ground ? 1 : 0;
    return out.buffer;
  };
}

function installRampCollisionHost(): void {
  const fields: Array<{ originX: number; originZ: number; cell: number; cols: number; rows: number; baseY: number; heights: Float32Array }> = [];
  globalThis.__game_physics_clear_heightfields = () => { fields.length = 0; };
  globalThis.__game_physics_register_heightfield = (
    _slot: number,
    originX: number,
    originZ: number,
    cell: number,
    cols: number,
    rows: number,
    baseY: number,
    _walkCos: number,
    heights: Float32Array,
  ) => {
    fields.push({ originX, originZ, cell, cols, rows, baseY, heights });
    return true;
  };
  const fieldGroundAt = (x: number, z: number): number | null => {
    let best: number | null = null;
    for (const field of fields) {
      const fx = (x - field.originX) / field.cell;
      const fz = (z - field.originZ) / field.cell;
      if (fx < 0 || fz < 0 || fx > field.cols - 1 || fz > field.rows - 1) continue;
      const x0 = Math.floor(fx);
      const z0 = Math.floor(fz);
      const x1 = Math.min(x0 + 1, field.cols - 1);
      const z1 = Math.min(z0 + 1, field.rows - 1);
      const tx = fx - x0;
      const tz = fz - z0;
      const h00 = field.heights[z0 * field.cols + x0];
      const h10 = field.heights[z0 * field.cols + x1];
      const h01 = field.heights[z1 * field.cols + x0];
      const h11 = field.heights[z1 * field.cols + x1];
      const hx0 = h00 + (h10 - h00) * tx;
      const hx1 = h01 + (h11 - h01) * tx;
      const h = field.baseY + hx0 + (hx1 - hx0) * tz;
      best = best === null ? h : Math.max(best, h);
    }
    return best;
  };
  globalThis.__game_physics_step = (wire: Float32Array): ArrayBuffer => {
    lastWire = wire;
    const dt = wire[0];
    const radius = wire[16];
    const height = wire[17];
    const stepHeight = wire[20];
    const rectCount = wire[13] | 0;
    let x = wire[5] + wire[8] * dt;
    let y = wire[6] + (wire[9] - wire[14] * dt) * dt;
    let z = wire[7] + wire[10] * dt;
    let vx = wire[8];
    let vy = wire[9] - wire[14] * dt;
    let vz = wire[10];
    let ground = -1000000;
    const hfGround = fieldGroundAt(x, z);
    if (hfGround !== null && hfGround <= y + stepHeight) ground = Math.max(ground, hfGround);
    let at = 25;
    for (let i = 0; i < rectCount; i += 1) {
      const minX = wire[at], minZ = wire[at + 1], maxX = wire[at + 2], maxZ = wire[at + 3];
      const top = wire[at + 4], solid = wire[at + 5] > 0.5, floor = wire[at + 8];
      if (x >= minX && x <= maxX && z >= minZ && z <= maxZ && top <= y + stepHeight) ground = Math.max(ground, top);
      if (solid && y < top - 0.04 && y + height > floor) {
        const closestX = Math.max(minX, Math.min(maxX, x));
        const closestZ = Math.max(minZ, Math.min(maxZ, z));
        const dx = x - closestX;
        const dz = z - closestZ;
        const d = Math.hypot(dx, dz);
        if (d < radius && d > 1e-6) {
          const nx = dx / d;
          const nz = dz / d;
          x += nx * (radius - d);
          if (vx * nx < 0) vx = 0;
          if (vz * nz < 0) vz = 0;
        }
      }
      at += 9;
    }
    if (y <= ground) {
      y = ground;
      if (vy < 0) vy = 0;
    }
    const out = new Float32Array(9);
    out[1] = x; out[2] = y; out[3] = z;
    out[4] = vx; out[5] = vy; out[6] = vz;
    out[7] = y === ground ? 1 : 0;
    return out.buffer;
  };
}

test('floor seams consume as continuous support, not a side rejection', () => {
  installFloorEdgeHost();
  const floorA = { minX: -1.5, minZ: -1.5, maxX: 1.5, maxZ: 1.5, topMeters: 0.2, blocksPlayer: true, friction: 0.85, restitution: 0.02, floorMeters: 0 };
  const floorB = { minX: 1.5, minZ: -1.5, maxX: 4.5, maxZ: 1.5, topMeters: 0.2, blocksPlayer: true, friction: 0.85, restitution: 0.02, floorMeters: 0 };
  const result = GAME_PHYSICS.step(stepInput({
    dtSeconds: 0.016,
    player: { position: { x: 1.5, y: 0.05, z: 0 }, velocity: { x: 0, y: -1, z: 0 }, yawDegrees: 0 },
    rects: [floorA, floorB],
  }))!;
  assertClose(result.player.position.x, 1.5, 1e-6, 'seam landing keeps x planted');
  assertClose(result.player.position.y, 0.2, 1e-6, 'seam landing snaps to floor top');
  assertEqual(result.player.grounded, true, 'seam landing stays grounded');
});

test('true outer floor edge supports to the bound without oscillating', () => {
  installFloorEdgeHost();
  const floor = { minX: -1.5, minZ: -1.5, maxX: 1.5, maxZ: 1.5, topMeters: 0.2, blocksPlayer: true, friction: 0.85, restitution: 0.02, floorMeters: 0 };
  let player = { x: 1.5, y: 0.05, z: 0, vx: 0, vy: -1, vz: 0 };
  for (let frame = 0; frame < 6; frame += 1) {
    const result = GAME_PHYSICS.step(stepInput({
      dtSeconds: 0.016,
      player: { position: { x: player.x, y: player.y, z: player.z }, velocity: { x: player.vx, y: player.vy, z: player.vz }, yawDegrees: 0 },
      rects: [floor],
    }))!;
    assertClose(result.player.position.x, 1.5, 1e-6, `outer edge frame ${frame} x does not oscillate`);
    assertClose(result.player.position.y, 0.2, 1e-6, `outer edge frame ${frame} y remains on top`);
    assertEqual(result.player.grounded, true, `outer edge frame ${frame} remains grounded`);
    player = {
      x: result.player.position.x,
      y: result.player.position.y,
      z: result.player.position.z,
      vx: result.player.velocity.x,
      vy: result.player.velocity.y,
      vz: result.player.velocity.z,
    };
  }
});

test('RAMPSIDE-0606: ramp side blocks the character while the slope still grounds', () => {
  installRampCollisionHost();
  GAME_PHYSICS.clearHeightfields();
  const ramp = buildPiece('ramp.concrete.common', 6, 6);
  const solids = placedPieceColliders([ramp]);
  const fields = placedPieceRamps([ramp], 0);
  for (const field of fields) GAME_PHYSICS.registerHeightfield(field);
  assertEqual(fields.length, 1, 'the ramp still registers its walkable slope');
  assertEqual(solids.rects.length, 3, 'side/back faces are now sent as solid rects');
  console.log(`[RAMPSIDE-0606] physics ramp bands=${solids.rects.map((r) => `x[${r.minX},${r.maxX}]z[${r.minZ},${r.maxZ}] top=${r.topMeters}`).join(';')} heightfield=x[${fields[0].originX},${fields[0].originX + fields[0].cellSizeMeters * (fields[0].cols - 1)}] z[${fields[0].originZ},${fields[0].originZ + fields[0].cellSizeMeters * (fields[0].rows - 1)}] heights=${Array.from(fields[0].heights).join(',')} oldIntruder=x[4.25,7.75]z[4.25,4.5]`);

  const slope = GAME_PHYSICS.step(stepInput({
    dtSeconds: 0.016,
    player: { position: { x: 6, y: 1.42, z: 6 }, velocity: { x: 0, y: -1, z: 0 }, yawDegrees: 0 },
    rects: solids.rects,
  }))!;
  assertClose(slope.player.position.y, catalogEntry('ramp.concrete.common').size.heightMeters / 2, 1e-6, 'center of the ramp still grounds on the slope');
  assertEqual(slope.player.grounded, true, 'slope walk remains grounded');

  let walker = { x: 6, y: 0, z: 4.5, vx: 0, vy: 0, vz: 3 };
  for (let frame = 0; frame < 20; frame += 1) {
    const walked = GAME_PHYSICS.step(stepInput({
      dtSeconds: 0.05,
      player: { position: { x: walker.x, y: walker.y, z: walker.z }, velocity: { x: walker.vx, y: walker.vy, z: walker.vz }, yawDegrees: 0 },
      rects: solids.rects,
    }))!;
    walker = {
      x: walked.player.position.x,
      y: walked.player.position.y,
      z: walked.player.position.z,
      vx: walked.player.velocity.x,
      vy: walked.player.velocity.y,
      vz: walker.vz,
    };
    assertEqual(walked.player.grounded, true, `walk-up frame ${frame} stays grounded`);
  }
  assert(walker.z >= 7.45, `walk-up reaches the crest instead of being blocked at the approach (z=${walker.z})`);
  assertClose(walker.y, catalogEntry('ramp.concrete.common').size.heightMeters, 0.05, 'walk-up reaches the ramp crest height');

  const leftSide = solids.rects.find((r) => r.maxX <= 4.5)!;
  const blocked = GAME_PHYSICS.step(stepInput({
    dtSeconds: 0.016,
    player: { position: { x: 4, y: 0, z: 6 }, velocity: { x: 6, y: 0, z: 0 }, yawDegrees: 0 },
    rects: solids.rects,
  }))!;
  assert(blocked.player.position.x <= leftSide.minX - TUNING.playerCapsuleRadiusMeters + 1e-6, 'walking into the ramp side is blocked before entering the wall face');
  removeFakeHost();
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
