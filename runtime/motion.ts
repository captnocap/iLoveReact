// motion — deterministic motion along a polyline: plan once, position is a
// pure function of time until something interrupts.
//
// The same contract as runtime/pathing.ts gives routes:
//
//   const plan = planMotion(path.points, { startTime: now, profile });
//   ... every frame: const m = sampleMotion(plan, now);   // exact, closed form
//   ... a red light / pedestrian / queue INTERRUPTS:
//   const cut = slicePath(plan, m.s, m.s + stopDistance);
//   const next = planMotion(cut, { startTime: now, startSpeed: m.speed, profile });
//
// sampleMotion(plan, t) is exact for ANY t — frame-rate independent, no
// per-tick integration, rewindable, and identical on every machine. Distance
// traveled (m.s) is part of the sample, so odometry (wheel spin, fare meters,
// skid marks) is deterministic too. Only interruptions create new state.
//
// The plan is a classic trapezoidal velocity schedule over the polyline's
// arc length:
//   1. corner caps — each interior waypoint gets a max speed from its turn
//      angle (a hairpin is slower than a kink),
//   2. backward pass — speeds pulled down so the brakes can always make the
//      next cap (and the full stop at the end),
//   3. forward pass — speeds pulled down so the throttle can actually reach
//      them from the start speed,
//   4. per segment: accel -> cruise -> brake phases with closed-form
//      s(t) = s0 + v0*t + a*t^2/2.

export type MotionProfile = {
  maxSpeed: number; // m/s
  accel: number; // m/s^2, throttle
  decel: number; // m/s^2, brakes
  /** floor through the sharpest corner (default 1.3 m/s) */
  minCornerSpeed?: number;
};

type Phase = { t: number; s: number; v: number; a: number; dt: number };

export type MotionPlan = {
  t0: number;
  duration: number;
  /** total arc length */
  total: number;
  points: [number, number][];
  cum: number[];
  phases: Phase[];
};

export type MotionSample = {
  x: number;
  z: number;
  /** path tangent at s (heading convention: forward = [sin, cos]) */
  headingDeg: number;
  speed: number;
  /** current acceleration (negative = braking) — drive brake-light/nose-dip */
  accel: number;
  /** arc distance traveled along THIS plan */
  s: number;
  done: boolean;
};

const DEG = 180 / Math.PI;

/** Cumulative arc lengths of a polyline — the route's measuring tape. */
export function measurePath(points: [number, number][]): { cum: number[]; total: number } {
  const cum: number[] = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    cum.push(total);
  }
  return { cum, total };
}

function cornerCap(points: [number, number][], i: number, profile: MotionProfile): number {
  const a = points[i - 1], b = points[i], c = points[i + 1];
  const h1 = Math.atan2(b[0] - a[0], b[1] - a[1]);
  const h2 = Math.atan2(c[0] - b[0], c[1] - b[1]);
  let turn = Math.abs((h2 - h1) * DEG);
  if (turn > 180) turn = 360 - turn;
  if (turn < 12) return profile.maxSpeed;
  const floor = profile.minCornerSpeed ?? 1.3;
  return Math.max(floor, profile.maxSpeed * Math.pow(Math.max(0, 1 - turn / 130), 1.15));
}

/**
 * Build the deterministic schedule. The plan always ENDS AT REST (endSpeed 0)
 * — "stop at the end of these points" is the only contract; to keep cruising
 * past an obstacle that cleared, replan with the remaining points.
 */
export function planMotion(points: [number, number][], opts: {
  startTime: number;
  profile: MotionProfile;
  startSpeed?: number;
}): MotionPlan {
  const { cum, total } = measurePath(points);
  const profile = opts.profile;
  const n = points.length;
  const plan: MotionPlan = { t0: opts.startTime, duration: 0, total, points, cum, phases: [] };
  if (n < 2 || total < 1e-4) return plan;

  // 1) per-waypoint speed caps
  const cap = new Array<number>(n);
  cap[0] = profile.maxSpeed;
  cap[n - 1] = 0;
  for (let i = 1; i < n - 1; i++) cap[i] = cornerCap(points, i, profile);

  // 2) backward pass — brakes must always make the next cap (and the stop)
  const allowed = cap.slice();
  for (let i = n - 2; i >= 0; i--) {
    const seg = cum[i + 1] - cum[i];
    allowed[i] = Math.min(
      cap[i],
      profile.maxSpeed,
      Math.sqrt(allowed[i + 1] * allowed[i + 1] + 2 * profile.decel * seg),
    );
  }

  // 3) forward pass — throttle must actually reach each speed. The start
  // speed is physical fact (keep it even over budget); the `brake` lower
  // bound keeps an overspeed entry honest — you can't shed speed faster
  // than the brakes allow, so a too-short slice overshoots its caps
  // slightly instead of teleport-stopping.
  const v = new Array<number>(n);
  v[0] = Math.max(0, opts.startSpeed ?? 0);
  for (let i = 1; i < n; i++) {
    const seg = cum[i] - cum[i - 1];
    const reach = Math.sqrt(v[i - 1] * v[i - 1] + 2 * profile.accel * seg);
    const brake = Math.sqrt(Math.max(0, v[i - 1] * v[i - 1] - 2 * profile.decel * seg));
    v[i] = Math.max(Math.min(allowed[i], reach, profile.maxSpeed), brake);
  }

  // 4) phases per segment
  let t = 0;
  for (let i = 0; i < n - 1; i++) {
    const L = cum[i + 1] - cum[i];
    if (L < 1e-6) continue;
    const vin = v[i];
    const vout = v[i + 1];
    // peak speed of the triangular profile that fits this segment
    let vc = Math.sqrt(
      (2 * profile.accel * profile.decel * L + profile.decel * vin * vin + profile.accel * vout * vout) /
      (profile.accel + profile.decel),
    );
    vc = Math.min(vc, profile.maxSpeed);
    const peak = Math.max(vc, vin, vout);
    const dAcc = peak > vin ? (peak * peak - vin * vin) / (2 * profile.accel) : 0;
    const dDec = peak > vout ? (peak * peak - vout * vout) / (2 * profile.decel) : 0;
    const dCruise = Math.max(0, L - dAcc - dDec);
    let s0 = cum[i];
    if (dAcc > 1e-6) {
      const dt = (peak - vin) / profile.accel;
      plan.phases.push({ t, s: s0, v: vin, a: profile.accel, dt });
      t += dt;
      s0 += dAcc;
    }
    if (dCruise > 1e-6 && peak > 1e-4) {
      const dt = dCruise / peak;
      plan.phases.push({ t, s: s0, v: peak, a: 0, dt });
      t += dt;
      s0 += dCruise;
    }
    if (dDec > 1e-6) {
      const dt = (peak - vout) / profile.decel;
      plan.phases.push({ t, s: s0, v: peak, a: -profile.decel, dt });
      t += dt;
    }
  }
  plan.duration = t;
  return plan;
}

/** Point + tangent heading at arc distance s along a measured polyline. */
export function pointOnPath(pts: [number, number][], cum: number[], s: number): { x: number; z: number; headingDeg: number } {
  if (pts.length === 0) return { x: 0, z: 0, headingDeg: 0 };
  if (pts.length === 1) return { x: pts[0][0], z: pts[0][1], headingDeg: 0 };
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const a = pts[i - 1];
  const b = pts[i];
  const seg = cum[i] - cum[i - 1];
  const k = seg > 1e-6 ? Math.max(0, Math.min(1, (s - cum[i - 1]) / seg)) : 0;
  return {
    x: a[0] + (b[0] - a[0]) * k,
    z: a[1] + (b[1] - a[1]) * k,
    headingDeg: Math.atan2(b[0] - a[0], b[1] - a[1]) * DEG,
  };
}

/** Exact state at time t — THE deterministic read. No integration, no drift. */
export function sampleMotion(plan: MotionPlan, t: number): MotionSample {
  const tau = t - plan.t0;
  if (plan.phases.length === 0 || tau >= plan.duration) {
    const end = pointOnPath(plan.points, plan.cum, plan.total);
    return { ...end, speed: 0, accel: 0, s: plan.total, done: true };
  }
  if (tau <= 0) {
    const start = pointOnPath(plan.points, plan.cum, 0);
    return { ...start, speed: plan.phases[0].v, accel: plan.phases[0].a, s: 0, done: false };
  }
  let phase = plan.phases[plan.phases.length - 1];
  for (const p of plan.phases) {
    if (tau < p.t + p.dt) { phase = p; break; }
  }
  const dt = Math.min(tau - phase.t, phase.dt);
  const s = phase.s + phase.v * dt + 0.5 * phase.a * dt * dt;
  const speed = Math.max(0, phase.v + phase.a * dt);
  return { ...pointOnPath(plan.points, plan.cum, s), speed, accel: phase.a, s, done: false };
}

/**
 * The interruption tool: the remaining polyline from arc s0 (optionally cut
 * at s1 — "stop THERE"). First/last points are exact interpolations, so a
 * replanned schedule starts precisely where the old sample stood. Works on
 * any measured polyline (a route), not just a plan's points.
 */
export function slicePoints(points: [number, number][], cum: number[], s0: number, s1 = Infinity): [number, number][] {
  const total = cum.length > 0 ? cum[cum.length - 1] : 0;
  const from = Math.max(0, Math.min(s0, total));
  const to = Math.max(from, Math.min(s1, total));
  const start = pointOnPath(points, cum, from);
  const out: [number, number][] = [[start.x, start.z]];
  for (let i = 0; i < points.length; i++) {
    if (cum[i] <= from + 1e-4) continue;
    if (cum[i] >= to - 1e-4) break;
    out.push(points[i]);
  }
  const end = pointOnPath(points, cum, to);
  const last = out[out.length - 1];
  if (Math.hypot(end.x - last[0], end.z - last[1]) > 1e-3) out.push([end.x, end.z]);
  return out;
}

export function slicePath(plan: MotionPlan, s0: number, s1 = Infinity): [number, number][] {
  return slicePoints(plan.points, plan.cum, s0, s1);
}
