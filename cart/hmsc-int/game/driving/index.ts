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
// Model: a kinematic bicycle (planar drive) wearing a rigid-body ROLL/PITCH
// layer. The drive layer is GRIP-LIMITED — the turn the wheels ask for is
// capped at what the tires can hold (maxLatG), and past that the car runs WIDE
// (understeer). That same lateral-load ceiling feeds the rollover: when the
// cornering load beats gravity's moment about the outer wheels, the car tips
// and FLIPS onto its side/roof (req_0558 — the GTA-4 register: heavy, low grip,
// turn-wide, unrelenting, and tippable). Flips bang up the body's damage states.
// The tunable knobs ARE the product: a handling lab dials these.

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
  /** How fast the wheels turn toward the input angle (1/s). Low = floaty,
   *  GTA-4 understeer; high = darty. */
  steerSpeed: number;
  /** Lateral grip (1/s): how fast a sideways slide is scrubbed off. Low =
   *  loose/driftable; high = the tail snaps back. */
  grip: number;
  /** Lateral grip while the handbrake is held (intentionally low → slides). */
  handbrakeGrip: number;
  /** Max cornering acceleration the tires hold (in g). The turn is capped here;
   *  ask for more and the car UNDERSTEERS wide. Also the rollover ceiling. */
  maxLatG: number;
  /** Tire scrub: how much hard cornering bleeds forward speed (1/s at full
   *  lock). 0 = full-speed donuts; higher = washes off speed in the turn. */
  corneringDrag: number;
  /** Visible body lean per g of cornering load (radians/g). */
  rollLeanGain: number;
  /** Cap on the cosmetic lean (radians) before it would be a real rollover. */
  maxLean: number;
  /** How fast the body settles to its lean target (1/s). */
  rollEase: number;
  /** CG height (m): the tip lever. Higher = tips at LOWER cornering g (a
   *  top-heavy van rolls before a low sports car). */
  cgHeight: number;
  /** Gravity that tumbles an upset car to rest, and damps the tumble. */
  rolloverGravity: number;
  rollDamping: number;
  /** Weight transfer → visible pitch (squat on throttle, dive on brake). */
  pitchGain: number;
  /** Front-to-rear axle distance (m). Longer = wider turning circle. */
  wheelBase: number;
  /** Track width (m): half this is the tip lever arm. From the body width. */
  trackWidth: number;
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
  /** Body roll (radians) about the length axis. 0 upright, ±π on the roof. */
  roll: number;
  rollVel: number;
  /** Body pitch (radians) about the lateral axis. + nose up (squat). */
  pitch: number;
  /** On its side/roof: traction gone, suspension off the ground, needs
   *  righting. Cleared automatically only if it flops back upright. */
  flipped: boolean;
};

export type CarInput = {
  /** 0..1 */
  throttle: number;
  /** 0..1 — also drives reverse once the car is stopped. */
  brake: number;
  /** -1..1 — negative steers left. */
  steer: number;
  handbrake: boolean;
  /** firm foot brake: decelerates to a STOP from either direction and holds —
   *  never reverses (the difference from `brake`). Optional/back-compatible. */
  footBrake?: boolean;
};

export type CarTelemetry = {
  /** Signed longitudinal speed (m/s); negative = reversing. */
  speed: number;
  /** Lateral (sideways) speed (m/s); magnitude grows as the car slides. */
  lateral: number;
  /** Slip angle (radians) between heading and travel — the drift readout. */
  slip: number;
  /** Body roll (radians) — the lean/rollover readout. */
  roll: number;
  /** True the frame the car tips past recovery into a flip (one-shot edge). */
  justFlipped: boolean;
  /** Derived gear, for the HUD. */
  gear: 'D' | 'R' | 'N';
};

export function makeCarState(x = 0, z = 0, heading = 0): CarState {
  return { x, z, heading, vx: 0, vz: 0, steer: 0, odometer: 0, roll: 0, rollVel: 0, pitch: 0, flipped: false };
}

/** Snap an upset car back onto its wheels in place (the lab's "right car"). */
export function rightCar(s: CarState): void {
  s.roll = 0;
  s.rollVel = 0;
  s.pitch = 0;
  s.flipped = false;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const GRAV = 9.81;

/** GTA-4 register by default: heavy, low grip, slow steering, turn-wide, and
 *  tip-prone. wheelBase/trackWidth come from the body the lab is driving. */
export function defaultTuning(wheelBase: number, trackWidth = 1.85): CarTuning {
  return {
    enginePower: 9,
    brakePower: 14,
    reversePower: 5,
    topSpeed: 34,
    reverseTopSpeed: 8,
    drag: 0.0008,
    rollResist: 0.5,
    maxSteer: 0.5,
    steerSpeed: 3.2,
    grip: 4.5,
    handbrakeGrip: 0.8,
    maxLatG: 1.05,
    corneringDrag: 0.5,
    rollLeanGain: 0.16,
    maxLean: 0.32,
    rollEase: 9,
    cgHeight: 0.95,
    rolloverGravity: 16,
    rollDamping: 4,
    pitchGain: 0.05,
    wheelBase,
    trackWidth,
  };
}

/** Advance the car one step. Mutates `s` in place (ref pattern, like
 *  ragdoll_lab's simRef) and returns the telemetry for the HUD. */
export function stepCar(s: CarState, input: CarInput, t: CarTuning, dt: number): CarTelemetry {
  const step = clamp(dt, 0, 0.05); // guard against tab-stall jumps
  // A flipped car has no traction or controls — it slides on its shell.
  const ctl = s.flipped
    ? { throttle: 0, brake: 0, steer: 0, handbrake: false, footBrake: false }
    : input;

  // Decompose world velocity into the car's own frame.
  const fx = Math.sin(s.heading);
  const fz = Math.cos(s.heading);
  const rx = Math.cos(s.heading); // right = forward rotated -90° about Y
  const rz = -Math.sin(s.heading);
  let vf = s.vx * fx + s.vz * fz; // longitudinal
  let vl = s.vx * rx + s.vz * rz; // lateral

  // Throttle / brake / reverse along the forward axis.
  if (ctl.throttle > 0) vf += ctl.throttle * t.enginePower * step;
  if (ctl.brake > 0) {
    if (vf > 0.2) {
      vf = Math.max(0, vf - ctl.brake * t.brakePower * step); // brake, don't snap to reverse
    } else {
      vf -= ctl.brake * t.reversePower * step; // rolling/stopped → reverse
    }
  }
  // Foot brake: firm decel to a stop from either direction, never reverses.
  if (ctl.footBrake) {
    const decel = t.brakePower * 1.4 * step;
    vf = vf > 0 ? Math.max(0, vf - decel) : Math.min(0, vf + decel);
  }
  vf = clamp(vf, -t.reverseTopSpeed, t.topSpeed);

  // Resistance: linear roll-off + quadratic air drag (both per-second → ·step).
  // Gentle on purpose: terminal speed stays above topSpeed so the clamp is the
  // REAL cap and the topSpeed knob bites. Flipped = heavy shell friction.
  vf -= vf * t.rollResist * step;
  vf -= vf * Math.abs(vf) * t.drag * step;
  if (s.flipped) { vf *= Math.exp(-3 * step); vl *= Math.exp(-3 * step); }

  // Lateral grip bleeds sideways velocity — low grip lets the tail step out.
  const grip = ctl.handbrake ? t.handbrakeGrip : t.grip;
  vl *= Math.exp(-grip * step);

  // Steering → heading, GRIP-LIMITED. The kinematic turn the wheels ask for can
  // exceed what the tires can hold; cap the cornering acceleration at maxLatG
  // and the car runs WIDE instead (understeer — the GTA-4 push).
  const targetSteer = ctl.steer * t.maxSteer;
  s.steer += (targetSteer - s.steer) * clamp(t.steerSpeed * step, 0, 1);
  let angularVel = (vf / t.wheelBase) * Math.tan(s.steer);
  const aLatMax = t.maxLatG * GRAV;
  let aLat = vf * angularVel; // centripetal accel demanded by this turn
  if (Math.abs(aLat) > aLatMax && Math.abs(aLat) > 1e-4) {
    angularVel *= aLatMax / Math.abs(aLat); // tires saturate → turn less → wide
    aLat = vf * angularVel;
  }
  s.heading += angularVel * step;

  // Tire scrub: cornering bleeds forward speed, scaled by how hard the wheels
  // are turned (fraction of full lock). Always toward 0, never reverses.
  const steerFrac = Math.abs(s.steer) / Math.max(0.001, t.maxSteer);
  vf -= vf * steerFrac * t.corneringDrag * step;

  // ── Body roll + rollover ────────────────────────────────────────────────
  const wasFlipped = s.flipped;
  if (!s.flipped) {
    // Cosmetic lean toward the lateral g the car is pulling.
    const leanTarget = clamp(-aLat / GRAV * t.rollLeanGain, -t.maxLean, t.maxLean);
    s.roll += (leanTarget - s.roll) * clamp(t.rollEase * step, 0, 1);
    s.rollVel = 0;
    // Trip point: cornering load beats gravity's stabilizing moment about the
    // outer wheels (g · halfTrack / cgHeight). Top-heavy/narrow → low threshold.
    const tipAccel = GRAV * (t.trackWidth * 0.5) / Math.max(0.2, t.cgHeight);
    if (Math.abs(aLat) > tipAccel) {
      s.flipped = true;
      // COMMIT the roll: the kick must clear the on-its-side peak (±π/2) so the
      // car actually goes OVER and plays out, instead of half-leaning and
      // snapping back every frame (the old 2.6 stranded it in a control-cutting
      // flicker). Energy to crest is ½v² > rolloverGravity·0.7, so kick past it.
      const crest = Math.sqrt(2 * t.rolloverGravity * 0.7) * 1.15;
      s.rollVel = (aLat > 0 ? -1 : 1) * crest; // kicked over to the outside
    }
  } else {
    // Rolled over — LET IT PLAY OUT, then recover. No freeze, no reset, no
    // mandatory keypress (req_0709). The body first TUMBLES on momentum:
    // bistable gravity (-sin(2·roll), minima wheels-down at 0 and roof-down at
    // ±π, unstable peak on its side at ±π/2) carries the roll wherever the flip
    // threw it, so the car genuinely goes over. The instant it comes to REST,
    // we self-right it — ease the body back onto its wheels in place and hand
    // control back — so a rollover resolves itself instead of stranding the car
    // upside-down. (R / the reset button still right it instantly if impatient.)
    const atRest = Math.abs(s.rollVel) < 1.0;
    if (atRest && Math.abs(s.roll) > 0.25) {
      s.roll += (0 - s.roll) * clamp(t.rollEase * 0.4 * step, 0, 1); // flop upright
      s.rollVel *= 0.6;
    } else {
      // Airborne tumble — LIGHT damping so the committed kick clears ±π/2 and the
      // car goes all the way over (heavy damping stalled it half-leaned, which is
      // what made it flicker). Bistable gravity then settles it roof-down (±π).
      s.rollVel += (-t.rollDamping * 0.12 * s.rollVel - t.rolloverGravity * 0.7 * Math.sin(2 * s.roll)) * step;
      s.roll += s.rollVel * step;
      if (s.roll > Math.PI) s.roll -= 2 * Math.PI;
      if (s.roll < -Math.PI) s.roll += 2 * Math.PI;
    }
    if (Math.abs(s.roll) < 0.25 && Math.abs(s.rollVel) < 0.6) { s.flipped = false; s.roll = 0; s.rollVel = 0; }
  }

  // Pitch is cosmetic weight transfer: squat on throttle, dive on brake.
  const longForce = (ctl.throttle > 0 ? ctl.throttle * t.enginePower : 0)
    - (vf > 0 ? (ctl.brake > 0 ? ctl.brake * t.brakePower : 0) + (ctl.footBrake ? t.brakePower * 1.4 : 0) : 0);
  const pitchTarget = clamp(longForce * t.pitchGain * 0.02, -0.1, 0.1);
  s.pitch += (pitchTarget - s.pitch) * clamp(8 * step, 0, 1);

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
  return {
    speed: vf,
    lateral: vl,
    slip: Math.atan2(vl, Math.abs(vf) + 1e-3),
    roll: s.roll,
    justFlipped: s.flipped && !wasFlipped,
    gear,
  };
}

export const GAME_DRIVING = Object.freeze({
  makeState: makeCarState,
  defaultTuning,
  step: stepCar,
  right: rightCar,
});
