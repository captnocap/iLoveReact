// game/driving/ — GAME_DRIVING: the FIRST driving model in the engine.
//
// Born here (2026-06-10, req_0522) rather than captured from a cart: this is
// the first time a vehicle MOVES. Per DECISIONS V1 physics is ONE coherent
// host-side system; this module lives cart-side on purpose — it is where the
// SHAPE of driving feel is found before it graduates into the host sim (the
// same path physics_lab/ragdoll_lab took with Verlet, the "no 3D physics in
// the host yet" answer). The vehicle-handling lab is its first consumer; the
// /test play route and the eventual host port are the next. Keep it pure and
// React-free so the graduation is a behavior port, not a rewrite.
//
// Model: a kinematic bicycle. Longitudinal speed is driven by engine/brake/
// drag; the rear stays planted by a grip term that bleeds lateral velocity
// every step (high grip = railed, low grip = drifts). Steering turns the
// heading at a rate proportional to forward speed — you cannot pivot a parked
// car, and reversing steers the tail — so the feel falls out of the geometry,
// not from special cases. The tunable knobs ARE the product: a handling lab
// dials these, so every feel parameter is exposed on CarTuning.

export type CarTuning = {
  /** Forward acceleration at full throttle (m/s²). */
  enginePower: number;
  /** Deceleration while braking (m/s²). */
  brakePower: number;
  /** Acceleration in reverse once stopped (m/s²). */
  reversePower: number;
  /** Forward speed cap (m/s). */
  topSpeed: number;
  /** Reverse speed cap (m/s). */
  reverseTopSpeed: number;
  /** Quadratic air drag — dominates at high speed. */
  drag: number;
  /** Linear rolling resistance — gentle coast-down. */
  rollResist: number;
  /** Maximum front-wheel angle (radians). */
  maxSteer: number;
  /** How fast the wheels turn toward the input angle (1/s). */
  steerSpeed: number;
  /** Lateral grip (1/s). High = railed; low = loose/driftable. */
  grip: number;
  /** Lateral grip while the handbrake is held (intentionally low → slides). */
  handbrakeGrip: number;
  /** Front-to-rear axle distance (m). Longer = wider turning circle. */
  wheelBase: number;
};

export type CarState = {
  /** World position (m). */
  x: number;
  z: number;
  /** Nose direction (radians). Forward unit = [sin(h), 0, cos(h)]. */
  heading: number;
  /** World velocity (m/s). */
  vx: number;
  vz: number;
  /** Current front-wheel angle (radians) — eased toward the input. */
  steer: number;
  /** Accumulated forward distance (m) — drives the visual wheel roll. */
  odometer: number;
};

export type CarInput = {
  /** 0..1 */
  throttle: number;
  /** 0..1 — also drives reverse once the car is stopped. */
  brake: number;
  /** -1..1 — negative steers left. */
  steer: number;
  handbrake: boolean;
};

export type CarTelemetry = {
  /** Signed longitudinal speed (m/s); negative = reversing. */
  speed: number;
  /** Lateral (sideways) speed (m/s); magnitude grows as the car slides. */
  lateral: number;
  /** Slip angle (radians) between heading and travel — the drift readout. */
  slip: number;
  /** Derived gear, for the HUD. */
  gear: 'D' | 'R' | 'N';
};

export function makeCarState(x = 0, z = 0, heading = 0): CarState {
  return { x, z, heading, vx: 0, vz: 0, steer: 0, odometer: 0 };
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** A sensible starting tune for a given wheelbase. Civilian-car feel: grippy,
 *  moderate power. Labs override individual knobs from here. */
export function defaultTuning(wheelBase: number): CarTuning {
  return {
    enginePower: 14,
    brakePower: 20,
    reversePower: 6,
    topSpeed: 30,
    reverseTopSpeed: 8,
    drag: 0.0008,
    rollResist: 0.4,
    maxSteer: 0.62,
    steerSpeed: 6,
    grip: 7.5,
    handbrakeGrip: 1.1,
    wheelBase,
  };
}

/** Advance the car one step. Mutates `s` in place (ref pattern, like
 *  ragdoll_lab's simRef) and returns the telemetry for the HUD. */
export function stepCar(s: CarState, input: CarInput, t: CarTuning, dt: number): CarTelemetry {
  const step = clamp(dt, 0, 0.05); // guard against tab-stall jumps

  // Decompose world velocity into the car's own frame.
  const fx = Math.sin(s.heading);
  const fz = Math.cos(s.heading);
  const rx = Math.cos(s.heading); // right = forward rotated -90° about Y
  const rz = -Math.sin(s.heading);
  let vf = s.vx * fx + s.vz * fz; // longitudinal
  let vl = s.vx * rx + s.vz * rz; // lateral

  // Throttle / brake / reverse along the forward axis.
  if (input.throttle > 0) vf += input.throttle * t.enginePower * step;
  if (input.brake > 0) {
    if (vf > 0.2) {
      vf = Math.max(0, vf - input.brake * t.brakePower * step); // brake, don't snap to reverse
    } else {
      vf -= input.brake * t.reversePower * step; // rolling/stopped → reverse
    }
  }
  vf = clamp(vf, -t.reverseTopSpeed, t.topSpeed);

  // Resistance: linear roll-off + quadratic air drag (both per-second → ·step).
  // Kept gentle on purpose: terminal speed stays above topSpeed so the clamp
  // above is the REAL cap and the topSpeed knob actually bites.
  vf -= vf * t.rollResist * step;
  vf -= vf * Math.abs(vf) * t.drag * step;

  // Lateral grip bleeds sideways velocity — low grip lets the tail step out.
  const grip = input.handbrake ? t.handbrakeGrip : t.grip;
  vl *= Math.exp(-grip * step);

  // Ease the steered angle toward the input, then turn the heading. Angular
  // velocity scales with forward speed (parked = no turn; reverse flips sign).
  const targetSteer = input.steer * t.maxSteer;
  s.steer += (targetSteer - s.steer) * clamp(t.steerSpeed * step, 0, 1);
  const angularVel = (vf / t.wheelBase) * Math.tan(s.steer);
  s.heading += angularVel * step;

  // Recompose world velocity from the updated frame and integrate position.
  const nfx = Math.sin(s.heading);
  const nfz = Math.cos(s.heading);
  const nrx = Math.cos(s.heading);
  const nrz = -Math.sin(s.heading);
  s.vx = vf * nfx + vl * nrx;
  s.vz = vf * nfz + vl * nrz;
  s.x += s.vx * step;
  s.z += s.vz * step;
  s.odometer += vf * step;

  const gear: CarTelemetry['gear'] = vf > 0.2 ? 'D' : vf < -0.2 ? 'R' : 'N';
  return { speed: vf, lateral: vl, slip: Math.atan2(vl, Math.abs(vf) + 1e-3), gear };
}

export const GAME_DRIVING = Object.freeze({
  makeState: makeCarState,
  defaultTuning,
  step: stepCar,
});
