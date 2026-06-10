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
import { PLACED_TUNING, placedPieceColliders, placedPieceRamps, type PlacedBuildPiece } from './build/placed';

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
  delete globalThis.__game_physics_step_into;
  delete globalThis.__game_physics_camera_occlusion;
  delete globalThis.__game_physics_camera_occlusion_configure;
  delete globalThis.__game_physics_camera_occlusion_distance;
  delete globalThis.__game_physics_camera_occlusion_hit;
  delete globalThis.__game_physics_register_heightfield;
  delete globalThis.__game_physics_clear_heightfields;
}

test('a missing host degrades to null, never throws', () => {
  removeFakeHost();
  assertEqual(GAME_PHYSICS.hostReady(), false, 'hostReady must be false without bindings');
  assertEqual(GAME_PHYSICS.step(stepInput()), null, 'step must return null without bindings');
  assertEqual(GAME_PHYSICS.cameraOcclusion({ camera: { x: 0, y: 1, z: -4 }, target: { x: 0, y: 1, z: 4 } }), null, 'camera occlusion is null without its host binding');
  GAME_PHYSICS.registerHeightfield({
    slot: 0, originX: 0, originZ: 0, cellSizeMeters: 1, cols: 2, rows: 2,
    baseY: 0, walkableSlopeCos: 0.7, heights: new Float32Array(4),
  });
  GAME_PHYSICS.clearHeightfields();
});

test('configured camera occlusion uploads pieces once and queries distance with scalar args', () => {
  removeFakeHost();
  let configured: Float32Array | null = null;
  let scalarArgs = '';
  let hitArgs = '';
  globalThis.__game_physics_camera_occlusion_configure = (wire: Float32Array): null => {
    configured = wire;
    return null;
  };
  globalThis.__game_physics_camera_occlusion_distance = (...args: number[]): number => {
    scalarArgs = args.map((n) => n.toFixed(3)).join(',');
    return 4.25;
  };
  globalThis.__game_physics_camera_occlusion_hit = (...args: number[]): ArrayBuffer => {
    hitArgs = args.map((n) => n.toFixed(3)).join(',');
    return new Float32Array([6, 4.25, 3]).buffer;
  };
  GAME_PHYSICS.configureCameraOcclusion([{
    minX: -2, minZ: -0.15, maxX: 2, maxZ: 0.15,
    topMeters: 3, floorMeters: 0, blocksPlayer: true,
    friction: 0.85, restitution: 0.02, ownerIndex: 3,
  }], []);
  assert(configured !== null, 'configured occlusion must call host configure');
  assertEqual(configured![0], 1, 'one rect configures');
  assertEqual(configured![1], 0, 'no oriented rects configure');
  assertEqual(configured![11], 3, 'owner id follows configured rect payload');
  const distance = GAME_PHYSICS.cameraOcclusionDistance(0, 1.5, -5, 0, 1.6, 5, 0.125);
  assertClose(distance ?? 0, 4.25, 1e-6, 'scalar distance returns');
  assertEqual(scalarArgs, '0.000,1.500,-5.000,0.000,1.600,5.000,0.125', 'distance call sends scalars, not a per-frame packed wall list');
  const hit = GAME_PHYSICS.cameraOcclusionConfiguredHit(0, 1.5, -5, 0, 1.6, 5, 0.125);
  assertClose(hit?.nearestTargetDistanceMeters ?? 0, 4.25, 1e-6, 'owner-aware hit returns distance');
  assertEqual(hit?.nearestOwnerIndex, 3, 'owner-aware hit returns configured owner');
  assertEqual(hitArgs, scalarArgs, 'hit call sends the same scalar hot-path args');
  removeFakeHost();
});

test('camera occlusion packs owner ids and maps host hits back across the bridge', () => {
  removeFakeHost();
  globalThis.__game_physics_camera_occlusion = (wire: Float32Array): ArrayBuffer => {
    lastWire = wire;
    const rectCount = wire[6] | 0;
    const at = 10;
    const owner = rectCount > 0 ? wire[at + 9] : 0;
    const out = new Float32Array([8, owner > 0 ? 1 : 0, 4.75, owner, owner]);
    return out.buffer;
  };
  const result = GAME_PHYSICS.cameraOcclusion({
    camera: { x: 0, y: 1.5, z: -5 },
    target: { x: 0, y: 1.5, z: 5 },
    maxHits: 4,
    radiusMeters: 0.125,
    rects: [{
      minX: -2, minZ: -0.15, maxX: 2, maxZ: 0.15,
      topMeters: 3, floorMeters: 0, blocksPlayer: true,
      friction: 0.85, restitution: 0.02, ownerIndex: 3,
    }],
  });
  assert(result !== null, 'camera occlusion must return with a live host');
  assertEqual(result!.ownerIndices.join(','), '3', 'owner id round-trips');
  assertClose(result!.nearestTargetDistanceMeters, 4.75, 1e-6, 'nearest target distance round-trips');
  assertEqual(result!.nearestOwnerIndex, 3, 'nearest owner id round-trips');
  assertEqual(lastWire![0], 0, 'camera x packs at the header');
  assertEqual(lastWire![2], -5, 'camera z packs at the header');
  assertEqual(lastWire![3], 0, 'target x packs at the header');
  assertEqual(lastWire![5], 5, 'target z packs at the header');
  assertEqual(lastWire![6], 1, 'one rect sent');
  assertEqual(lastWire![8], 4, 'max hit cap sent');
  assertClose(lastWire![9], 0.125, 1e-6, 'sweep radius packs at the header');
  assertEqual(lastWire![19], 3, 'owner id follows the rect payload');
  removeFakeHost();
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

test('steady physics steps reuse the input wire scratch buffer', () => {
  installFakeHost();
  const rects = Array.from({ length: 16 }, (_, i) => ({
    minX: i,
    minZ: i,
    maxX: i + 1,
    maxZ: i + 1,
    topMeters: 1,
    blocksPlayer: true,
    friction: 0.3,
    restitution: 0.5,
  }));
  GAME_PHYSICS.step(stepInput({ rects }));
  const firstWire = lastWire;
  assert(firstWire !== null, 'host receives first scratch wire');
  GAME_PHYSICS.step(stepInput({ rects }));
  assert(lastWire === firstWire, 'same-size step reuses the same Float32Array');
  GAME_PHYSICS.step(stepInput({ rects: rects.slice(0, 4) }));
  assert(lastWire === firstWire, 'smaller steady step reuses the same Float32Array capacity');
});

test('allocation-free host step writes into the reused output scratch buffer', () => {
  removeFakeHost();
  let lastInput: Float32Array | null = null;
  let lastOutput: Float32Array | null = null;
  globalThis.__game_physics_step_into = (wire: Float32Array, out: Float32Array): number => {
    lastInput = wire;
    lastOutput = out;
    const dt = wire[0];
    const gravity = wire[14];
    const vy = wire[9] - gravity * dt;
    out[0] = 321;
    out[1] = wire[5];
    out[2] = wire[6] + vy * dt;
    out[3] = wire[7];
    out[4] = wire[8];
    out[5] = vy;
    out[6] = wire[10];
    out[7] = 0;
    out[8] = 0;
    return 9;
  };
  const first = GAME_PHYSICS.step(stepInput());
  const firstInput = lastInput;
  const firstOutput = lastOutput;
  assert(first !== null, 'step_into returns a result');
  assertClose(first!.hostMicroseconds, 321, 1e-5, 'step_into host telemetry round-trips');
  GAME_PHYSICS.step(stepInput());
  assert(lastInput === firstInput, 'step_into reuses the input scratch Float32Array');
  assert(lastOutput === firstOutput, 'step_into reuses the output scratch Float32Array');
  removeFakeHost();
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
  const fields: Array<{ originX: number; originZ: number; cell: number; cols: number; rows: number; baseY: number; heights: Float32Array; sloped: boolean }> = [];
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
    let sloped = false;
    for (let i = 1; i < heights.length; i += 1) {
      if (Math.abs(heights[i] - heights[0]) > 1e-6) {
        sloped = true;
        break;
      }
    }
    fields.push({ originX, originZ, cell, cols, rows, baseY, heights, sloped });
    return true;
  };
  const fieldSurfaceAt = (x: number, z: number, currentY: number, stepHeight: number, requireSlope = false): { height: number; sloped: boolean } | null => {
    let best: { height: number; sloped: boolean } | null = null;
    for (const field of fields) {
      if (requireSlope && !field.sloped) continue;
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
      if (h > currentY + stepHeight) continue;
      if (best === null || h > best.height) best = { height: h, sloped: field.sloped };
    }
    return best;
  };
  const fieldGroundAt = (x: number, z: number, currentY: number, stepHeight: number, requireSlope = false): number | null =>
    fieldSurfaceAt(x, z, currentY, stepHeight, requireSlope)?.height ?? null;
  globalThis.__game_physics_step = (wire: Float32Array): ArrayBuffer => {
    lastWire = wire;
    const dt = wire[0];
    const speed = wire[3];
    const radius = wire[16];
    const height = wire[17];
    const stepHeight = wire[20];
    const grace = wire[11];
    const rectCount = wire[13] | 0;
    let vx = wire[8];
    let vy = wire[9] - wire[14] * dt;
    let vz = wire[10];
    const startSurface = fieldSurfaceAt(wire[5], wire[7], wire[6], stepHeight);
    if (startSurface?.sloped && speed > 0) {
      const horizontalSpeed = Math.hypot(vx, vz);
      const nextSurface = horizontalSpeed > 1e-6
        ? fieldSurfaceAt(wire[5] + vx * dt, wire[7] + vz * dt, wire[6], stepHeight)
        : null;
      if (nextSurface && nextSurface.height > startSurface.height) {
        const slopeAlong = (nextSurface.height - startSurface.height) / (horizontalSpeed * dt);
        const maxHorizontal = speed / Math.sqrt(1 + slopeAlong * slopeAlong);
        if (horizontalSpeed > maxHorizontal) {
          const scale = maxHorizontal / horizontalSpeed;
          vx *= scale;
          vz *= scale;
        }
      }
    }
    let x = wire[5] + vx * dt;
    let y = wire[6] + vy * dt;
    let z = wire[7] + vz * dt;
    let ground = -1000000;
    const hfGround = fieldGroundAt(x, z, y, stepHeight);
    if (hfGround !== null && hfGround <= y + stepHeight) ground = Math.max(ground, hfGround);
    let at = 25;
    for (let i = 0; i < rectCount; i += 1) {
      const minX = wire[at], minZ = wire[at + 1], maxX = wire[at + 2], maxZ = wire[at + 3];
      const top = wire[at + 4], solid = wire[at + 5] > 0.5, floor = wire[at + 8];
      if (x >= minX && x <= maxX && z >= minZ && z <= maxZ && top <= y + stepHeight) ground = Math.max(ground, top);
      if (solid && y < top - 0.04 && y + height > floor) {
        const finiteFloor = floor > -100000;
        const slopeWalkable = finiteFloor && fieldGroundAt(x, z, y, stepHeight, true) !== null;
        const graceWalkable = finiteFloor && top <= y + stepHeight && grace > 0 && y >= floor - grace;
        if (slopeWalkable || graceWalkable) {
          at += 9;
          continue;
        }
        const closestX = Math.max(minX, Math.min(maxX, x));
        const closestZ = Math.max(minZ, Math.min(maxZ, z));
        const dx = x - closestX;
        const dz = z - closestZ;
        let d = Math.hypot(dx, dz);
        let nx = 0;
        let nz = 0;
        if (d < 1e-6) {
          const sideX = Math.min(Math.abs(x - minX), Math.abs(maxX - x));
          const sideZ = Math.min(Math.abs(z - minZ), Math.abs(maxZ - z));
          if (sideX < sideZ) nx = x < (minX + maxX) * 0.5 ? -1 : 1;
          else nz = z < (minZ + maxZ) * 0.5 ? -1 : 1;
          d = 1;
        } else {
          nx = dx / d;
          nz = dz / d;
        }
        if (d < radius) {
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

test('RAMPREAL-0606: ramp slab walks on top, stays hollow underneath, and blocks through the slab edge', () => {
  installRampCollisionHost();
  GAME_PHYSICS.clearHeightfields();
  const ramp = buildPiece('ramp.concrete.common', 6, 6);
  const solids = placedPieceColliders([ramp]);
  const fields = placedPieceRamps([ramp], 0);
  for (const field of fields) GAME_PHYSICS.registerHeightfield(field);
  assertEqual(fields.length, 1, 'the ramp still registers its walkable slope');
  assertEqual(solids.rects.length, PLACED_TUNING.rampSlabEdgeSegments * 3 + 1, 'ramp sends slab core + thin edges, not full-height wall bands');
  console.log(`[RAMPREAL-0606] physics ramp slabBands=${solids.rects.map((r) => `x[${r.minX},${r.maxX}]z[${r.minZ},${r.maxZ}] y[${r.floorMeters},${r.topMeters}]`).join(';')} heightfield=x[${fields[0].originX},${fields[0].originX + fields[0].cellSizeMeters * (fields[0].cols - 1)}] z[${fields[0].originZ},${fields[0].originZ + fields[0].cellSizeMeters * (fields[0].rows - 1)}] heights=${Array.from(fields[0].heights).join(',')}`);

  const slope = GAME_PHYSICS.step(stepInput({
    dtSeconds: 0.016,
    player: { position: { x: 6, y: 1.42, z: 6 }, velocity: { x: 0, y: -1, z: 0 }, yawDegrees: 0 },
    rects: solids.rects,
  }))!;
  assertClose(slope.player.position.y, catalogEntry('ramp.concrete.common').size.heightMeters / 2, 1e-6, 'center of the ramp still grounds on the slope');
  assertEqual(slope.player.grounded, true, 'slope walk remains grounded');

  let walker = { x: 6, y: 0, z: 4.5, vx: 0, vy: 0, vz: 3 };
  const walkUpFrames: string[] = [];
  for (let frame = 0; frame < 27; frame += 1) {
    const before = { ...walker };
    const walked = GAME_PHYSICS.step(stepInput({
      dtSeconds: 0.05,
      tuning: { ...TUNING, walkableRectSidePushGraceMeters: 0 },
      speedMetersPerSecond: 3,
      player: { position: { x: walker.x, y: walker.y, z: walker.z }, velocity: { x: walker.vx, y: walker.vy, z: walker.vz }, yawDegrees: 0 },
      rects: solids.rects,
    }))!;
    walker = {
      x: walked.player.position.x,
      y: walked.player.position.y,
      z: walked.player.position.z,
      vx: walked.player.velocity.x,
      vy: walked.player.velocity.y,
      vz: walked.player.velocity.z,
    };
    const surfaceSpeed = Math.hypot(walker.x - before.x, walker.y - before.y, walker.z - before.z) / 0.05;
    walkUpFrames.push(`${frame}:surfaceSpeed=${surfaceSpeed.toFixed(3)} pos(${walker.x.toFixed(3)},${walker.y.toFixed(3)},${walker.z.toFixed(3)}) vel(${walker.vx.toFixed(3)},${walker.vy.toFixed(3)},${walker.vz.toFixed(3)}) grounded=${walked.player.grounded}`);
    assertEqual(walked.player.grounded, true, `walk-up frame ${frame} stays grounded`);
    assert(surfaceSpeed <= 3.01, `RAMPVEL-0608 frame ${frame} keeps ramp surface speed at run speed (got ${surfaceSpeed})`);
  }
  console.log(`[RAMPVEL-0608] zeroGrace walkUp=${walkUpFrames.join(' | ')}`);
  assert(walker.z >= 7.35, `walk-up advances to the ramp top approach instead of being blocked at the approach (z=${walker.z})`);
  assertClose(walker.y, 2.85, 0.08, 'walk-up gains height at the clamped surface speed');

  const floorUnderRamp = { minX: 4.5, minZ: 4.5, maxX: 7.5, maxZ: 7.5, topMeters: 0, blocksPlayer: true, friction: 0.85, restitution: 0.02, floorMeters: -0.2 };
  let under = { x: 5.2, y: 0, z: 6.9, vx: 1.5, vy: 0, vz: 0 };
  for (let frame = 0; frame < 8; frame += 1) {
    const walked = GAME_PHYSICS.step(stepInput({
      dtSeconds: 0.05,
      player: { position: { x: under.x, y: under.y, z: under.z }, velocity: { x: under.vx, y: under.vy, z: under.vz }, yawDegrees: 0 },
      rects: [floorUnderRamp, ...solids.rects],
    }))!;
    under = {
      x: walked.player.position.x,
      y: walked.player.position.y,
      z: walked.player.position.z,
      vx: walked.player.velocity.x,
      vy: walked.player.velocity.y,
      vz: walked.player.velocity.z,
    };
    assertEqual(walked.player.grounded, true, `under-ramp frame ${frame} stays on the lower floor`);
    assertClose(walked.player.position.y, 0, 1e-6, `under-ramp frame ${frame} does not snap up to the slope`);
  }
  assert(under.x > 5.7, `walking under the raised slab keeps moving through the open space (x=${under.x})`);

  let underTowardSlab = { x: 6, y: 0, z: 6.9, vx: 0, vy: 0, vz: -2.5 };
  const underTowardFrames: string[] = [];
  for (let frame = 0; frame < 14; frame += 1) {
    const walked = GAME_PHYSICS.step(stepInput({
      dtSeconds: 0.05,
      player: { position: { x: underTowardSlab.x, y: underTowardSlab.y, z: underTowardSlab.z }, velocity: { x: underTowardSlab.vx, y: underTowardSlab.vy, z: underTowardSlab.vz }, yawDegrees: 0 },
      rects: [floorUnderRamp, ...solids.rects],
    }))!;
    underTowardSlab = {
      x: walked.player.position.x,
      y: walked.player.position.y,
      z: walked.player.position.z,
      vx: walked.player.velocity.x,
      vy: walked.player.velocity.y,
      vz: walked.player.velocity.z,
    };
    underTowardFrames.push(`${frame}:pos(${underTowardSlab.x.toFixed(3)},${underTowardSlab.y.toFixed(3)},${underTowardSlab.z.toFixed(3)}) vel(${underTowardSlab.vx.toFixed(3)},${underTowardSlab.vy.toFixed(3)},${underTowardSlab.vz.toFixed(3)})`);
    assertClose(walked.player.position.y, 0, 1e-6, `under-to-slab frame ${frame} stays on the lower floor`);
  }
  console.log(`[RAMPHOLLOW-0606] under-high-walks sideEnd=(${under.x.toFixed(3)},${under.y.toFixed(3)},${under.z.toFixed(3)}) towardLow=${underTowardFrames.join(' | ')}`);
  assert(underTowardSlab.z > 6.55, `walking at the ramp from underneath blocks at head contact instead of phasing through the lowering slab (z=${underTowardSlab.z})`);
  assertClose(underTowardSlab.y, 0, 1e-6, 'walking at the underside never snaps up onto the slope heightfield');

  const leftSide = solids.rects.find((r) => r.maxX <= 4.5 && r.minZ <= 6 && r.maxZ >= 6)!;
  const blocked = GAME_PHYSICS.step(stepInput({
    dtSeconds: 0.016,
    player: { position: { x: 4, y: 0, z: 6 }, velocity: { x: 6, y: 0, z: 0 }, yawDegrees: 0 },
    rects: solids.rects,
  }))!;
  assert(blocked.player.position.x <= leftSide.minX - TUNING.playerCapsuleRadiusMeters + 1e-6, 'walking into the slab edge at body height is blocked');
  removeFakeHost();
});

test('RAMPHOLLOW-0607: terrain heightfield remains ground under a ramp heightfield', () => {
  installRampCollisionHost();
  GAME_PHYSICS.clearHeightfields();
  const ramp = buildPiece('ramp.concrete.common', 6, 6);
  const solids = placedPieceColliders([ramp]);
  GAME_PHYSICS.registerHeightfield({
    slot: 0,
    originX: 4.5,
    originZ: 4.5,
    cellSizeMeters: 3,
    cols: 2,
    rows: 2,
    baseY: 0,
    walkableSlopeCos: 1,
    heights: new Float32Array([0, 0, 0, 0]),
  });
  for (const field of placedPieceRamps([ramp], 1)) GAME_PHYSICS.registerHeightfield(field);

  let under = { x: 5.2, y: 0, z: 6.9, vx: 1.5, vy: 0, vz: 0 };
  const frames: string[] = [];
  for (let frame = 0; frame < 10; frame += 1) {
    const walked = GAME_PHYSICS.step(stepInput({
      dtSeconds: 0.05,
      player: { position: { x: under.x, y: under.y, z: under.z }, velocity: { x: under.vx, y: under.vy, z: under.vz }, yawDegrees: 0 },
      rects: solids.rects,
    }))!;
    under = {
      x: walked.player.position.x,
      y: walked.player.position.y,
      z: walked.player.position.z,
      vx: walked.player.velocity.x,
      vy: walked.player.velocity.y,
      vz: walked.player.velocity.z,
    };
    frames.push(`${frame}:pos(${under.x.toFixed(3)},${under.y.toFixed(3)},${under.z.toFixed(3)}) vel(${under.vx.toFixed(3)},${under.vy.toFixed(3)},${under.vz.toFixed(3)}) grounded=${walked.player.grounded}`);
    assertClose(under.y, 0, 1e-6, `under-ramp terrain frame ${frame} stays on the real ground`);
    assertEqual(walked.player.grounded, true, `under-ramp terrain frame ${frame} remains grounded`);
  }
  console.log(`[RAMPHOLLOW-0607] terrain+ramp heightfield coexist ${frames.join(' | ')}`);
  assert(under.x > 5.8, `walking under the ramp keeps moving over the terrain heightfield (x=${under.x})`);
  removeFakeHost();
});

test('STAIRS-0607: stairs walk up, keep terrain underneath, and block from the side', () => {
  installRampCollisionHost();
  GAME_PHYSICS.clearHeightfields();
  const stairs = buildPiece('stairs.wood.common', 6, 6);
  const solids = placedPieceColliders([stairs]);
  GAME_PHYSICS.registerHeightfield({
    slot: 0,
    originX: 4.5,
    originZ: 3,
    cellSizeMeters: 3,
    cols: 2,
    rows: 3,
    baseY: 0,
    walkableSlopeCos: 1,
    heights: new Float32Array([0, 0, 0, 0, 0, 0]),
  });
  const stairFields = placedPieceRamps([stairs], 1);
  for (const field of stairFields) GAME_PHYSICS.registerHeightfield(field);
  assertEqual(stairFields.length, 1, 'stairs register one heightfield');

  let walker = { x: 6, y: 0, z: 4.1, vx: 0, vy: 0, vz: 2.5 };
  const upFrames: string[] = [];
  for (let frame = 0; frame < 24; frame += 1) {
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
      vz: walked.player.velocity.z,
    };
    upFrames.push(`${frame}:pos(${walker.x.toFixed(3)},${walker.y.toFixed(3)},${walker.z.toFixed(3)}) grounded=${walked.player.grounded}`);
    assertEqual(walked.player.grounded, true, `stair walk-up frame ${frame} stays grounded`);
  }
  assert(walker.z > 6.6, `walking up stairs advances up the run (z=${walker.z})`);
  assert(walker.y > 1.8, `walking up stairs gains height instead of falling through (y=${walker.y})`);

  let under = { x: 6, y: 0, z: 6.9, vx: 0.8, vy: 0, vz: 0 };
  const underFrames: string[] = [];
  for (let frame = 0; frame < 8; frame += 1) {
    const walked = GAME_PHYSICS.step(stepInput({
      dtSeconds: 0.05,
      player: { position: { x: under.x, y: under.y, z: under.z }, velocity: { x: under.vx, y: under.vy, z: under.vz }, yawDegrees: 0 },
      rects: solids.rects,
    }))!;
    under = {
      x: walked.player.position.x,
      y: walked.player.position.y,
      z: walked.player.position.z,
      vx: walked.player.velocity.x,
      vy: walked.player.velocity.y,
      vz: walked.player.velocity.z,
    };
    underFrames.push(`${frame}:pos(${under.x.toFixed(3)},${under.y.toFixed(3)},${under.z.toFixed(3)}) grounded=${walked.player.grounded}`);
    assertClose(under.y, 0, 1e-6, `under-stair terrain frame ${frame} stays on the real ground`);
    assertEqual(walked.player.grounded, true, `under-stair terrain frame ${frame} remains grounded`);
  }

  const side = GAME_PHYSICS.step(stepInput({
    dtSeconds: 0.05,
    player: { position: { x: 4.8, y: 0, z: 6 }, velocity: { x: 2.5, y: 0, z: 0 }, yawDegrees: 0 },
    rects: solids.rects,
  }))!;
  console.log(`[STAIRS-0607] registration rects=${solids.rects.map((r) => `x[${r.minX},${r.maxX}]z[${r.minZ},${r.maxZ}] y[${r.floorMeters},${r.topMeters}]`).join(';')} field=origin(${stairFields[0].originX},${stairFields[0].originZ}) cell=${stairFields[0].cellSizeMeters} cols=${stairFields[0].cols} rows=${stairFields[0].rows} heights=${Array.from(stairFields[0].heights).join(',')} walkUp=${upFrames.join(' | ')} under=${underFrames.join(' | ')} side=pos(${side.player.position.x.toFixed(3)},${side.player.position.y.toFixed(3)},${side.player.position.z.toFixed(3)}) vel(${side.player.velocity.x.toFixed(3)},${side.player.velocity.y.toFixed(3)},${side.player.velocity.z.toFixed(3)})`);
  assert(side.player.position.x <= 4.81, `walking into the stair side is blocked (x=${side.player.position.x})`);
  assertClose(side.player.position.y, 0, 1e-6, 'side-block case stays on terrain ground');
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
