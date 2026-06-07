// game/physics.ts — GAME_PHYSICS: the game door over the host physics system.
//
// V1: physics is ONE coherent system, host-side. This door speaks the HONEST
// binding names (`__game_physics_*`, framework/v8_bindings_game_physics.zig —
// the WO-1 registrar, gated by -Dhas-game-physics per V18). The registrar also
// keeps the legacy `__hmsc_*` names registered for the OLD carts' JS callers;
// this door deliberately does NOT fall back to them — a missing honest name
// means the gate didn't flip, and silence there would mask the V18 bug.
//
// The wire dialect is the one the live consumer speaks today —
// cart/hmsc/state/hostPhysics.ts is the BEHAVIOR REFERENCE (V17-TRIAGE:
// capture = rewrite fresh, never import the old file).
//
// P2: this door owns ZERO behavior constants. Gravity, jump speed, capsule
// size, friction, restitution — every gameplay number arrives per call from
// the caller's tuning (the V20 data/tuning layer when it lands). The numeric
// constants below are WIRE-FORMAT facts: slot counts, the host's hard caps,
// and the solid-floor sentinel. They mirror the host protocol, not gameplay.

import { GAME_TELEMETRY } from './telemetry';

export type Vec3 = { x: number; y: number; z: number };

/** The gameplay numbers the host integrator needs every step (P2: caller-owned). */
export type PhysicsTuning = {
  gravityMetersPerSecondSquared: number;
  jumpSpeedMetersPerSecond: number;
  playerCapsuleRadiusMeters: number;
  playerCapsuleHeightMeters: number;
  wallRestitution: number;
  bodyRestitution: number;
  playerStepHeightMeters: number;
  /** Suppress lateral floor-edge pushes while a walkable rect top is within step reach. */
  walkableRectSidePushGraceMeters?: number;
};

/** How the surface under the player feels this step. */
export type SurfaceFeel = {
  accelerationMultiplier: number;
  friction: number;
  restitution: number;
};

/** A dynamic sphere body the host steps alongside the player. */
export type PhysicsBody = {
  position: Vec3;
  velocity: Vec3;
  radiusMeters: number;
  restitution: number;
};

/** An axis-aligned solid band the player collides with and can stand on. */
export type CollisionRect = {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  /** top of the solid band — the standable surface */
  topMeters: number;
  /** true = blocks horizontal movement; false = surface only (roads, pads) */
  blocksPlayer: boolean;
  friction: number;
  restitution: number;
  /** bottom of the solid band; omit for solid-to-the-ground (walls, props) */
  floorMeters?: number;
};

/** A CollisionRect in a rotated frame: the same band, plus pivot + yaw. */
export type OrientedCollisionRect = CollisionRect & {
  pivotX: number;
  pivotZ: number;
  yawRadians: number;
};

export type CameraOcclusionRect = CollisionRect & {
  ownerIndex: number;
};

export type CameraOcclusionOrientedRect = OrientedCollisionRect & {
  ownerIndex: number;
};

export type PhysicsStepInput = {
  dtSeconds: number;
  /** normalized movement intent on the ground plane (camera-relative is the caller's job) */
  intentX: number;
  intentZ: number;
  /** target ground speed for full intent, m/s */
  speedMetersPerSecond: number;
  jumpDown: boolean;
  player: {
    position: Vec3;
    velocity: Vec3;
    yawDegrees: number;
  };
  surface: SurfaceFeel;
  tuning: PhysicsTuning;
  bodies?: PhysicsBody[];
  rects?: CollisionRect[];
  orientedRects?: OrientedCollisionRect[];
};

export type SteppedBody = {
  position: Vec3;
  velocity: Vec3;
  radiusMeters: number;
  grounded: boolean;
};

export type PhysicsStepResult = {
  /** host-side step cost, microseconds (telemetry) */
  hostMicroseconds: number;
  player: { position: Vec3; velocity: Vec3; grounded: boolean };
  bodies: SteppedBody[];
};

export type CameraOcclusionInput = {
  camera: Vec3;
  target: Vec3;
  rects?: CameraOcclusionRect[];
  orientedRects?: CameraOcclusionOrientedRect[];
  maxHits?: number;
  radiusMeters?: number;
};

export type CameraOcclusionResult = {
  hostMicroseconds: number;
  ownerIndices: number[];
  nearestTargetDistanceMeters: number;
  nearestOwnerIndex: number;
};

export type CameraOcclusionConfiguredHit = {
  hostMicroseconds: number;
  nearestTargetDistanceMeters: number;
  nearestOwnerIndex: number;
};

/** A baked terrain grid the host samples as sloped ground (see-it == walk-it). */
export type Heightfield = {
  /** host collider slot, 0..HEIGHTFIELD_SLOTS-1 — re-registering a slot replaces it */
  slot: number;
  originX: number;
  originZ: number;
  cellSizeMeters: number;
  cols: number;
  rows: number;
  baseY: number;
  /** cos of the steepest walkable slope */
  walkableSlopeCos: number;
  /** row-major cols×rows heights, meters above baseY */
  heights: Float32Array;
  /** rotated frame (a turned building's floor); omit for axis-aligned terrain */
  yawRadians?: number;
  pivotX?: number;
  pivotZ?: number;
};

// ── The wire protocol (mirrors framework/v8_bindings_physics_lab.zig + the
//    hostPhysics.ts behavior reference; these are facts, not tuning) ─────────
export const PHYSICS_TUNING = Object.freeze({
  /** FLOOREDGE-0606: feet this close below a walkable floor band count as landing/on it,
   *  so the side resolver does not shove the capsule off seams or true edges. */
  walkableRectSidePushGraceMeters: 0.08,
  knobs: Object.freeze({
    walkableRectSidePushGraceMeters: { min: 0, max: 0.25, step: 0.005, precision: 3 },
  }),
});

const INPUT_HEADER_FLOATS = 25;
const BODY_FLOATS = 8;
const RECT_FLOATS = 9;
const ORIENTED_FLOATS = 12;
const OUTPUT_HEADER_FLOATS = 9;
const CAMERA_OCCLUSION_HEADER_FLOATS = 10;
const CAMERA_OCCLUSION_RECT_FLOATS = RECT_FLOATS + 1;
const CAMERA_OCCLUSION_ORIENTED_FLOATS = ORIENTED_FLOATS + 1;
const CAMERA_OCCLUSION_MAX_HITS = 64;

/** Host hard caps — exceeding one is a caller bug, surfaced at the boundary. */
export const PHYSICS_LIMITS = Object.freeze({
  bodies: 128,
  rects: 2048,
  orientedRects: 256,
});

/** floorMeters sentinel: the rect is solid all the way down. */
const SOLID_TO_GROUND = -1e9;

declare const globalThis: any;

type HostFn<T extends (...args: any[]) => any> = { fn: T; name: string };

let liveStepProbePrinted = false;
let missingStepProbePrinted = false;
let heightfieldProbeCount = 0;
let missingHeightfieldRegisterPrinted = false;

function hostStepFn(): HostFn<(input: Float32Array) => ArrayBuffer | null> | null {
  const honest = globalThis.__game_physics_step;
  if (typeof honest === 'function') return { fn: honest, name: '__game_physics_step' };
  const legacy = globalThis.__hmsc_physics_step;
  if (typeof legacy === 'function') return { fn: legacy, name: '__hmsc_physics_step' };
  if (!missingStepProbePrinted) {
    missingStepProbePrinted = true;
    console.warn('[game-physics live] no host step fn', {
      hasGameStep: typeof honest,
      hasLegacyStep: typeof legacy,
    });
  }
  return null;
}

function hostCameraOcclusionFn(): HostFn<(input: Float32Array) => ArrayBuffer | null> | null {
  const honest = globalThis.__game_physics_camera_occlusion;
  if (typeof honest === 'function') return { fn: honest, name: '__game_physics_camera_occlusion' };
  return null;
}

function hostCameraOcclusionConfigureFn(): HostFn<(input: Float32Array) => null> | null {
  const honest = globalThis.__game_physics_camera_occlusion_configure;
  if (typeof honest === 'function') return { fn: honest, name: '__game_physics_camera_occlusion_configure' };
  return null;
}

function hostCameraOcclusionDistanceFn(): HostFn<(cx: number, cy: number, cz: number, tx: number, ty: number, tz: number, radius: number) => number | null> | null {
  const honest = globalThis.__game_physics_camera_occlusion_distance;
  if (typeof honest === 'function') return { fn: honest, name: '__game_physics_camera_occlusion_distance' };
  return null;
}

function hostCameraOcclusionHitFn(): HostFn<(cx: number, cy: number, cz: number, tx: number, ty: number, tz: number, radius: number) => ArrayBuffer | null> | null {
  const honest = globalThis.__game_physics_camera_occlusion_hit;
  if (typeof honest === 'function') return { fn: honest, name: '__game_physics_camera_occlusion_hit' };
  return null;
}

/** True when the host physics bindings are compiled into this binary. */
export function physicsHostReady(): boolean {
  return hostStepFn() !== null;
}

function packRect(out: number[], rect: CollisionRect): void {
  out.push(
    rect.minX,
    rect.minZ,
    rect.maxX,
    rect.maxZ,
    rect.topMeters,
    rect.blocksPlayer ? 1 : 0,
    rect.friction,
    rect.restitution,
    rect.floorMeters ?? SOLID_TO_GROUND,
  );
}

function packCameraOcclusionRect(out: number[], rect: CameraOcclusionRect): void {
  packRect(out, rect);
  out.push(rect.ownerIndex);
}

function writeRect(out: Float32Array, at: number, rect: CollisionRect): number {
  out[at++] = rect.minX;
  out[at++] = rect.minZ;
  out[at++] = rect.maxX;
  out[at++] = rect.maxZ;
  out[at++] = rect.topMeters;
  out[at++] = rect.blocksPlayer ? 1 : 0;
  out[at++] = rect.friction;
  out[at++] = rect.restitution;
  out[at++] = rect.floorMeters ?? SOLID_TO_GROUND;
  return at;
}

/**
 * One host physics step: player movement + gravity + body sim + collision
 * against the supplied solids. Returns null when the host bindings are not
 * compiled in (the cart still runs; nothing is solid).
 */
export function stepPhysics(input: PhysicsStepInput): PhysicsStepResult | null {
  const stepHost = hostStepFn();
  if (!stepHost) return null;

  const bodies = input.bodies ?? [];
  const rects = input.rects ?? [];
  const oriented = input.orientedRects ?? [];
  if (bodies.length > PHYSICS_LIMITS.bodies) {
    throw new Error(`stepPhysics: ${bodies.length} bodies exceeds the host cap of ${PHYSICS_LIMITS.bodies}`);
  }
  if (rects.length > PHYSICS_LIMITS.rects) {
    throw new Error(`stepPhysics: ${rects.length} rects exceeds the host cap of ${PHYSICS_LIMITS.rects}`);
  }
  if (oriented.length > PHYSICS_LIMITS.orientedRects) {
    throw new Error(`stepPhysics: ${oriented.length} oriented rects exceeds the host cap of ${PHYSICS_LIMITS.orientedRects}`);
  }

  const wire = new Float32Array(
    INPUT_HEADER_FLOATS + bodies.length * BODY_FLOATS + rects.length * RECT_FLOATS + oriented.length * ORIENTED_FLOATS,
  );
  const { player, surface, tuning } = input;
  wire[0] = input.dtSeconds;
  wire[1] = input.intentX;
  wire[2] = input.intentZ;
  wire[3] = input.speedMetersPerSecond;
  wire[4] = input.jumpDown ? 1 : 0;
  wire[5] = player.position.x;
  wire[6] = player.position.y;
  wire[7] = player.position.z;
  wire[8] = player.velocity.x;
  wire[9] = player.velocity.y;
  wire[10] = player.velocity.z;
  wire[11] = tuning.walkableRectSidePushGraceMeters ?? PHYSICS_TUNING.walkableRectSidePushGraceMeters;
  wire[12] = bodies.length;
  wire[13] = rects.length;
  wire[14] = tuning.gravityMetersPerSecondSquared;
  wire[15] = tuning.jumpSpeedMetersPerSecond;
  wire[16] = tuning.playerCapsuleRadiusMeters;
  wire[17] = tuning.playerCapsuleHeightMeters;
  wire[18] = tuning.wallRestitution;
  wire[19] = tuning.bodyRestitution;
  wire[20] = tuning.playerStepHeightMeters;
  wire[21] = surface.accelerationMultiplier;
  wire[22] = surface.friction;
  wire[23] = surface.restitution;
  wire[24] = oriented.length;

  let at = INPUT_HEADER_FLOATS;
  for (const body of bodies) {
    wire[at++] = body.position.x;
    wire[at++] = body.position.y;
    wire[at++] = body.position.z;
    wire[at++] = body.velocity.x;
    wire[at++] = body.velocity.y;
    wire[at++] = body.velocity.z;
    wire[at++] = body.radiusMeters;
    wire[at++] = body.restitution;
  }
  const rectFloats: number[] = [];
  for (const rect of rects) packRect(rectFloats, rect);
  wire.set(rectFloats, at);
  at += rectFloats.length;
  const orientedFloats: number[] = [];
  for (const rect of oriented) {
    packRect(orientedFloats, rect);
    orientedFloats.push(rect.pivotX, rect.pivotZ, rect.yawRadians);
  }
  wire.set(orientedFloats, at);

  if (!liveStepProbePrinted) {
    liveStepProbePrinted = true;
    console.warn('[game-physics live] step wire', {
      fn: stepHost.name,
      headerFloats: INPUT_HEADER_FLOATS,
      wireFloats: wire.length,
      dt: wire[0],
      player: { x: wire[5], y: wire[6], z: wire[7], vx: wire[8], vy: wire[9], vz: wire[10] },
      slot11WalkableGrace: wire[11],
      bodies: wire[12],
      rects: wire[13],
      gravity: wire[14],
      stepHeight: wire[20],
      orientedRects: wire[24],
      firstRect: rects[0] ?? null,
      firstOrientedRect: oriented[0] ?? null,
    });
  }

  const buffer = stepHost.fn(wire);
  if (!buffer || typeof (buffer as any).byteLength !== 'number') return null;
  const out = new Float32Array(buffer);
  if (out.length < OUTPUT_HEADER_FLOATS) return null;
  const bodyCount = Math.min(bodies.length, Math.max(0, Math.floor(out[8] || 0)));
  if (out.length < OUTPUT_HEADER_FLOATS + bodyCount * BODY_FLOATS) return null;

  const steppedBodies: SteppedBody[] = new Array(bodyCount);
  let read = OUTPUT_HEADER_FLOATS;
  for (let i = 0; i < bodyCount; i += 1) {
    steppedBodies[i] = {
      position: { x: out[read++], y: out[read++], z: out[read++] },
      velocity: { x: out[read++], y: out[read++], z: out[read++] },
      radiusMeters: out[read++] || bodies[i].radiusMeters,
      grounded: (out[read++] || 0) > 0,
    };
  }

  const result = {
    hostMicroseconds: out[0] || 0,
    player: {
      position: { x: out[1] || 0, y: out[2] || 0, z: out[3] || 0 },
      velocity: { x: out[4] || 0, y: out[5] || 0, z: out[6] || 0 },
      grounded: (out[7] || 0) > 0,
    },
    bodies: steppedBodies,
  };
  GAME_TELEMETRY.recordDiagnostic('physics', 'step', {
    hostUs: result.hostMicroseconds,
    bodies: bodies.length,
    rects: rects.length,
    orientedRects: oriented.length,
    inputBytes: wire.byteLength,
    outputBytes: out.byteLength,
  });
  GAME_TELEMETRY.recordDiagnostic('bridge', '__game_physics_step', {
    args: 1,
    payloadBytes: wire.byteLength + out.byteLength,
  });
  return result;
}

export function cameraOcclusion(input: CameraOcclusionInput): CameraOcclusionResult | null {
  const host = hostCameraOcclusionFn();
  if (!host) return null;
  const rects = input.rects ?? [];
  const oriented = input.orientedRects ?? [];
  if (rects.length > PHYSICS_LIMITS.rects) {
    throw new Error(`cameraOcclusion: ${rects.length} rects exceeds the host cap of ${PHYSICS_LIMITS.rects}`);
  }
  if (oriented.length > PHYSICS_LIMITS.orientedRects) {
    throw new Error(`cameraOcclusion: ${oriented.length} oriented rects exceeds the host cap of ${PHYSICS_LIMITS.orientedRects}`);
  }
  const maxHits = Math.max(1, Math.min(CAMERA_OCCLUSION_MAX_HITS, Math.floor(input.maxHits ?? CAMERA_OCCLUSION_MAX_HITS)));
  const radiusMeters = Math.max(0, Number.isFinite(input.radiusMeters) ? input.radiusMeters ?? 0 : 0);
  const wire = new Float32Array(
    CAMERA_OCCLUSION_HEADER_FLOATS
      + rects.length * CAMERA_OCCLUSION_RECT_FLOATS
      + oriented.length * CAMERA_OCCLUSION_ORIENTED_FLOATS,
  );
  wire[0] = input.camera.x;
  wire[1] = input.camera.y;
  wire[2] = input.camera.z;
  wire[3] = input.target.x;
  wire[4] = input.target.y;
  wire[5] = input.target.z;
  wire[6] = rects.length;
  wire[7] = oriented.length;
  wire[8] = maxHits;
  wire[9] = radiusMeters;
  let at = CAMERA_OCCLUSION_HEADER_FLOATS;
  const rectFloats: number[] = [];
  for (const rect of rects) packCameraOcclusionRect(rectFloats, rect);
  wire.set(rectFloats, at);
  at += rectFloats.length;
  const orientedFloats: number[] = [];
  for (const rect of oriented) {
    packRect(orientedFloats, rect);
    orientedFloats.push(rect.pivotX, rect.pivotZ, rect.yawRadians, rect.ownerIndex);
  }
  wire.set(orientedFloats, at);

  const buffer = host.fn(wire);
  if (!buffer || typeof (buffer as any).byteLength !== 'number') return null;
  const out = new Float32Array(buffer);
  if (out.length < 4) return null;
  const hitCount = Math.max(0, Math.min(maxHits, Math.floor(out[1] || 0), out.length - 4));
  const ownerIndices: number[] = [];
  for (let i = 0; i < hitCount; i += 1) {
    const owner = Math.floor(out[4 + i] || 0);
    if (owner > 0) ownerIndices.push(owner);
  }
  GAME_TELEMETRY.recordDiagnostic('physics', 'cameraOcclusion', {
    hostUs: out[0] || 0,
    rects: rects.length,
    orientedRects: oriented.length,
    hits: ownerIndices.length,
    nearestTargetDistanceMeters: out[2] || 0,
    nearestOwnerIndex: Math.floor(out[3] || 0),
    radiusMeters,
    inputBytes: wire.byteLength,
    outputBytes: out.byteLength,
  });
  GAME_TELEMETRY.recordDiagnostic('bridge', host.name, {
    args: 1,
    payloadBytes: wire.byteLength + out.byteLength,
  });
  return {
    hostMicroseconds: out[0] || 0,
    ownerIndices,
    nearestTargetDistanceMeters: out[2] || 0,
    nearestOwnerIndex: Math.floor(out[3] || 0),
  };
}

export function configureCameraOcclusion(rects: readonly CameraOcclusionRect[], orientedRects: readonly CameraOcclusionOrientedRect[] = []): void {
  const host = hostCameraOcclusionConfigureFn();
  if (!host) return;
  if (rects.length > PHYSICS_LIMITS.rects) {
    throw new Error(`configureCameraOcclusion: ${rects.length} rects exceeds the host cap of ${PHYSICS_LIMITS.rects}`);
  }
  if (orientedRects.length > PHYSICS_LIMITS.orientedRects) {
    throw new Error(`configureCameraOcclusion: ${orientedRects.length} oriented rects exceeds the host cap of ${PHYSICS_LIMITS.orientedRects}`);
  }
  const wire = new Float32Array(
    2
      + rects.length * CAMERA_OCCLUSION_RECT_FLOATS
      + orientedRects.length * CAMERA_OCCLUSION_ORIENTED_FLOATS,
  );
  wire[0] = rects.length;
  wire[1] = orientedRects.length;
  let at = 2;
  for (const rect of rects) {
    at = writeRect(wire, at, rect);
    wire[at++] = rect.ownerIndex;
  }
  for (const rect of orientedRects) {
    at = writeRect(wire, at, rect);
    wire[at++] = rect.pivotX;
    wire[at++] = rect.pivotZ;
    wire[at++] = rect.yawRadians;
    wire[at++] = rect.ownerIndex;
  }
  host.fn(wire);
  if (GAME_TELEMETRY.diagnosticChannelEnabled('physics')) {
    GAME_TELEMETRY.recordDiagnostic('physics', 'cameraOcclusion.configure', {
      rects: rects.length,
      orientedRects: orientedRects.length,
      inputBytes: wire.byteLength,
    });
  }
  if (GAME_TELEMETRY.diagnosticChannelEnabled('bridge')) {
    GAME_TELEMETRY.recordDiagnostic('bridge', host.name, {
      args: 1,
      payloadBytes: wire.byteLength,
    });
  }
}

export function cameraOcclusionDistance(
  cameraX: number,
  cameraY: number,
  cameraZ: number,
  targetX: number,
  targetY: number,
  targetZ: number,
  radiusMeters: number,
): number | null {
  const host = hostCameraOcclusionDistanceFn();
  if (!host) return null;
  const radius = Math.max(0, Number.isFinite(radiusMeters) ? radiusMeters : 0);
  const distance = host.fn(cameraX, cameraY, cameraZ, targetX, targetY, targetZ, radius);
  return typeof distance === 'number' && Number.isFinite(distance) ? Math.max(0, distance) : null;
}

export function cameraOcclusionConfiguredHit(
  cameraX: number,
  cameraY: number,
  cameraZ: number,
  targetX: number,
  targetY: number,
  targetZ: number,
  radiusMeters: number,
): CameraOcclusionConfiguredHit | null {
  const host = hostCameraOcclusionHitFn();
  if (!host) {
    const distance = cameraOcclusionDistance(cameraX, cameraY, cameraZ, targetX, targetY, targetZ, radiusMeters);
    return distance === null ? null : { hostMicroseconds: 0, nearestTargetDistanceMeters: distance, nearestOwnerIndex: 0 };
  }
  const radius = Math.max(0, Number.isFinite(radiusMeters) ? radiusMeters : 0);
  const buffer = host.fn(cameraX, cameraY, cameraZ, targetX, targetY, targetZ, radius);
  if (!buffer || typeof (buffer as any).byteLength !== 'number') return null;
  const out = new Float32Array(buffer);
  if (out.length < 3) return null;
  if (GAME_TELEMETRY.diagnosticChannelEnabled('physics')) {
    GAME_TELEMETRY.recordDiagnostic('physics', 'cameraOcclusion.hit', {
      hostUs: out[0] || 0,
      nearestTargetDistanceMeters: out[1] || 0,
      nearestOwnerIndex: Math.floor(out[2] || 0),
      radiusMeters: radius,
      outputBytes: out.byteLength,
    });
  }
  if (GAME_TELEMETRY.diagnosticChannelEnabled('bridge')) {
    GAME_TELEMETRY.recordDiagnostic('bridge', host.name, {
      args: 7,
      payloadBytes: out.byteLength,
    });
  }
  return {
    hostMicroseconds: out[0] || 0,
    nearestTargetDistanceMeters: Math.max(0, out[1] || 0),
    nearestOwnerIndex: Math.floor(out[2] || 0),
  };
}

/**
 * Register (or replace) one heightfield terrain collider. No-op when the host
 * bindings are missing — terrain just isn't solid until the host carries them.
 */
export function registerHeightfield(field: Heightfield): void {
  const honest = globalThis.__game_physics_register_heightfield;
  const legacy = globalThis.__hmsc_register_heightfield;
  const register = typeof honest === 'function' ? honest : typeof legacy === 'function' ? legacy : null;
  if (typeof register !== 'function') {
    if (!missingHeightfieldRegisterPrinted) {
      missingHeightfieldRegisterPrinted = true;
      console.warn('[game-physics live] no heightfield register fn', {
        slot: field.slot,
        cols: field.cols,
        rows: field.rows,
        hasGameRegister: typeof honest,
        hasLegacyRegister: typeof legacy,
      });
    }
    return;
  }
  if (heightfieldProbeCount < 8) {
    heightfieldProbeCount += 1;
    console.warn('[game-physics live] heightfield.register', {
      fn: typeof honest === 'function' ? '__game_physics_register_heightfield' : '__hmsc_register_heightfield',
      slot: field.slot,
      originX: field.originX,
      originZ: field.originZ,
      cell: field.cellSizeMeters,
      cols: field.cols,
      rows: field.rows,
      baseY: field.baseY,
      walkableSlopeCos: field.walkableSlopeCos,
      heightBytes: field.heights.byteLength,
      yawRadians: field.yawRadians ?? 0,
      pivotX: field.pivotX ?? 0,
      pivotZ: field.pivotZ ?? 0,
    });
  }
  GAME_TELEMETRY.recordDiagnostic('physics', 'heightfield.register', {
    slot: field.slot,
    cols: field.cols,
    rows: field.rows,
    heightBytes: field.heights.byteLength,
  });
  GAME_TELEMETRY.recordDiagnostic('bridge', '__game_physics_register_heightfield', {
    args: 12,
    payloadBytes: field.heights.byteLength + 11 * 8,
  });
  register(
    field.slot,
    field.originX,
    field.originZ,
    field.cellSizeMeters,
    field.cols,
    field.rows,
    field.baseY,
    field.walkableSlopeCos,
    field.heights,
    field.yawRadians ?? 0,
    field.pivotX ?? 0,
    field.pivotZ ?? 0,
  );
}

/** Drop every registered heightfield (world reload). */
export function clearHeightfields(): void {
  const clear = typeof globalThis.__game_physics_clear_heightfields === 'function'
    ? globalThis.__game_physics_clear_heightfields
    : globalThis.__hmsc_clear_heightfields;
  if (typeof clear === 'function') {
    GAME_TELEMETRY.recordDiagnostic('physics', 'heightfield.clear');
    GAME_TELEMETRY.recordDiagnostic('bridge', '__game_physics_clear_heightfields', { args: 0, payloadBytes: 0 });
    clear();
  }
}

export const GAME_PHYSICS = Object.freeze({
  hostReady: physicsHostReady,
  step: stepPhysics,
  cameraOcclusion,
  configureCameraOcclusion,
  cameraOcclusionConfiguredHit,
  cameraOcclusionDistance,
  registerHeightfield,
  clearHeightfields,
  limits: PHYSICS_LIMITS,
  tuning: PHYSICS_TUNING,
});
