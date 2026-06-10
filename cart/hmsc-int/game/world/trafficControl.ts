// game/world/trafficControl — traffic-control props become RUNTIME right-of-way
// (TRAFFICGATE-0610, USER ASK req_0554: "look at the prop that is a stop sign
// and a intersection light, we need to connect those to props into the system").
//
// The locked grammar (roadData.ts header): "Right-of-way (signals, yields)
// gates the box at RUNTIME, not in the path graph." So nothing here touches
// kinds, costs, or the A* grid. The pieces:
//
//   • JUNCTION BOXES — clusters of 'junction' cells in the painted 1m grid
//     (the same flow-neutral overlap boxes the road stamps lay down), found by
//     flood fill. The box is the thing a vehicle ENTERS.
//   • ASSOCIATION — a placed stopSign/trafficLight prop attaches to the
//     nearest box within reach, governing the APPROACH it faces against
//     (yaw 0 faces -Z; a control faces BACK against the traffic it governs —
//     the hmsc/world/traffic.ts convention, kept exactly).
//   • THE GATE, AT PLAN TIME (V5: position is a pure function of t) —
//     planMotionWithStops splits a route's deterministic schedule at each
//     controlled stop line: a stop sign ends the segment AT REST on the line
//     (plans always end at rest — the full stop falls out of the split) and
//     holds STOP_SIGN_PAUSE; a signal holds until its axis' next green. A
//     green-at-arrival signal does NOT split — traffic flows through. The
//     stop line is the OUTER edge of the 2-deep crosswalk band ringing the
//     box (the grammar: the crosswalk IS the stop line).
//
// Phase timing reuses cart/hmsc/world/traffic.ts TRAFFIC_SIGNAL_CYCLE — the
// SAME cycle the lamp render glows with, so a planned wait matches what the
// player sees lit. Pure CPU, time always a parameter (P4: trafficControl.test).

import { TRAFFIC_SIGNAL_CYCLE } from '../../../hmsc/world/traffic';
import { planMotion, measurePath, sampleMotion, slicePoints, type MotionPlan, type MotionProfile, type MotionSample } from '@reactjit/motion';
import { TILE_KIND_INDEX } from '../kinds';
import type { PaintedGrid } from './navPublish';

export const TRAFFIC_TUNING = {
  /** how far a control prop reaches to claim its junction box (meters) */
  associationRadiusMeters: 12,
  /** the full-stop hold at a stop sign before proceeding */
  stopSignPauseSeconds: 1.5,
  /** stop line = box edge + the 2-deep crosswalk band (the grammar) */
  stopLineMeters: 2,
} as const;

// ── junction boxes (clusters of 'junction' cells) ───────────────────────────

export type JunctionBox = {
  id: number;
  /** world-space bounds (meters) */
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  centerX: number;
  centerZ: number;
  cells: number;
};

/** Flood-fill the painted grid's 'junction' cells into boxes (4-connected;
 *  bounds are each cluster's bounding rect — road-grammar boxes ARE rects). */
export function findJunctionBoxes(grid: PaintedGrid): JunctionBox[] {
  const junctionIdx = TILE_KIND_INDEX.junction;
  const { cols, rows, kinds } = grid;
  const seen = new Uint8Array(cols * rows);
  const boxes: JunctionBox[] = [];
  const stack: number[] = [];
  for (let start = 0; start < kinds.length; start++) {
    if (seen[start] || kinds[start] !== junctionIdx) continue;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity, count = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % cols;
      const z = Math.floor(i / cols);
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
      const tryCell = (j: number) => {
        if (!seen[j] && kinds[j] === junctionIdx) { seen[j] = 1; stack.push(j); }
      };
      if (x > 0) tryCell(i - 1);
      if (x < cols - 1) tryCell(i + 1);
      if (z > 0) tryCell(i - cols);
      if (z < rows - 1) tryCell(i + cols);
    }
    boxes.push({
      id: boxes.length,
      minX: grid.origin[0] + minX,
      minZ: grid.origin[1] + minZ,
      maxX: grid.origin[0] + maxX + 1,
      maxZ: grid.origin[1] + maxZ + 1,
      centerX: grid.origin[0] + (minX + maxX + 1) / 2,
      centerZ: grid.origin[1] + (minZ + maxZ + 1) / 2,
      cells: count,
    });
  }
  return boxes;
}

// ── association (prop → box → the approach it governs) ──────────────────────

/** travel direction INTO the box (matches PATH_FLOW axes) */
export type ApproachDir = 'posX' | 'negX' | 'posZ' | 'negZ';

export type PlacedTrafficControl = {
  control: 'stopSign' | 'signal';
  x: number;
  z: number;
  /** yaw 0 faces -Z (north) — the world facing convention */
  yawDegrees: number;
};

export type JunctionControl = { control: PlacedTrafficControl; approach: ApproachDir };
export type ControlledJunction = { box: JunctionBox; controls: JunctionControl[] };

/** The approach a control governs: the prop faces BACK against its traffic
 *  (hmsc/world/traffic.ts), so governed travel = the opposite of its facing,
 *  snapped to the dominant axis. */
export function controlApproach(yawDegrees: number): ApproachDir {
  const yaw = yawDegrees * Math.PI / 180;
  // facing = (-sin, -cos); governed travel = -facing = (sin, cos)
  const dx = Math.sin(yaw);
  const dz = Math.cos(yaw);
  if (Math.abs(dx) >= Math.abs(dz)) return dx >= 0 ? 'posX' : 'negX';
  return dz >= 0 ? 'posZ' : 'negZ';
}

/** Attach every control prop to its nearest box within reach. Props with no
 *  box in range attach nowhere (a stop sign in a field governs nothing). */
export function associateTrafficControls(
  boxes: readonly JunctionBox[],
  controls: readonly PlacedTrafficControl[],
  radiusMeters: number = TRAFFIC_TUNING.associationRadiusMeters,
): ControlledJunction[] {
  const out: ControlledJunction[] = boxes.map((box) => ({ box, controls: [] }));
  for (const control of controls) {
    let best = -1;
    let bestD = radiusMeters;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      // distance to the box rect (0 inside)
      const dx = Math.max(b.minX - control.x, 0, control.x - b.maxX);
      const dz = Math.max(b.minZ - control.z, 0, control.z - b.maxZ);
      const d = Math.hypot(dx, dz);
      if (d <= bestD) { bestD = d; best = i; }
    }
    if (best >= 0) out[best].controls.push({ control, approach: controlApproach(control.yawDegrees) });
  }
  return out;
}

// ── the signal cycle (the lamp's own clock, per axis) ───────────────────────

export type SignalPhase = 'go' | 'caution' | 'stop';

/** x-axis approaches run half a period out of phase with z-axis ones — the
 *  same mapping hmsc/world/traffic.ts derives from a lamp's facing yaw, so the
 *  planned wait and the rendered glow agree. */
export function signalAxisPhase(axis: 'x' | 'z', timeSeconds: number): SignalPhase {
  const cycle = TRAFFIC_SIGNAL_CYCLE;
  const offset = axis === 'x' ? cycle.periodSeconds / 2 : 0;
  const t = (((timeSeconds + offset) % cycle.periodSeconds) + cycle.periodSeconds) % cycle.periodSeconds;
  if (t < cycle.goSeconds) return 'go';
  if (t < cycle.goSeconds + cycle.cautionSeconds) return 'caution';
  return 'stop';
}

/** seconds until this axis' next green STARTS (0 when green right now) */
export function secondsUntilGreen(axis: 'x' | 'z', timeSeconds: number): number {
  if (signalAxisPhase(axis, timeSeconds) === 'go') return 0;
  const cycle = TRAFFIC_SIGNAL_CYCLE;
  const offset = axis === 'x' ? cycle.periodSeconds / 2 : 0;
  const t = (((timeSeconds + offset) % cycle.periodSeconds) + cycle.periodSeconds) % cycle.periodSeconds;
  return cycle.periodSeconds - t;
}

const approachAxis = (a: ApproachDir): 'x' | 'z' => (a === 'posX' || a === 'negX' ? 'x' : 'z');

/** How long a vehicle arriving at `arrivalSeconds` on `approach` must HOLD at
 *  this junction's stop line. 0 = no control on that approach / green. */
export function junctionEntryDelay(junction: ControlledJunction, approach: ApproachDir, arrivalSeconds: number): number {
  let delay = 0;
  for (const { control, approach: governed } of junction.controls) {
    if (governed !== approach) continue;
    if (control.control === 'stopSign') {
      delay = Math.max(delay, TRAFFIC_TUNING.stopSignPauseSeconds);
    } else {
      delay = Math.max(delay, secondsUntilGreen(approachAxis(approach), arrivalSeconds));
    }
  }
  return delay;
}

// ── plan-time stops (the deterministic schedule splits at stop lines) ───────

type StopLineCrossing = { s: number; approach: ApproachDir; junction: ControlledJunction };

/** Every place the path crosses INTO a controlled box's stop-line rect (the
 *  box expanded by the crosswalk band), in path order. */
export function stopLineCrossings(
  points: readonly [number, number][],
  junctions: readonly ControlledJunction[],
  stopLineMeters: number = TRAFFIC_TUNING.stopLineMeters,
): StopLineCrossing[] {
  if (points.length < 2) return [];
  const { cum } = measurePath(points as [number, number][]);
  const out: StopLineCrossing[] = [];
  for (const junction of junctions) {
    if (junction.controls.length === 0) continue;
    const b = junction.box;
    const minX = b.minX - stopLineMeters;
    const maxX = b.maxX + stopLineMeters;
    const minZ = b.minZ - stopLineMeters;
    const maxZ = b.maxZ + stopLineMeters;
    const inside = (p: readonly [number, number]) => p[0] >= minX && p[0] <= maxX && p[1] >= minZ && p[1] <= maxZ;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const c = points[i];
      if (inside(a)) continue; // an ENTRY starts outside
      // slab-clip the segment against the rect; t0 = where it crosses in
      const dx = c[0] - a[0];
      const dz = c[1] - a[1];
      let t0 = 0;
      let t1 = 1;
      let miss = false;
      for (const [p0, d, lo, hi] of [[a[0], dx, minX, maxX], [a[1], dz, minZ, maxZ]] as const) {
        if (d === 0) {
          if (p0 < lo || p0 > hi) { miss = true; break; }
          continue;
        }
        const ta = (lo - p0) / d;
        const tb = (hi - p0) / d;
        t0 = Math.max(t0, Math.min(ta, tb));
        t1 = Math.min(t1, Math.max(ta, tb));
      }
      if (miss || t0 > t1 || t0 <= 0) continue;
      const segLen = Math.hypot(dx, dz);
      const heading: ApproachDir = Math.abs(dx) >= Math.abs(dz)
        ? (dx >= 0 ? 'posX' : 'negX')
        : (dz >= 0 ? 'posZ' : 'negZ');
      out.push({ s: cum[i - 1] + segLen * t0, approach: heading, junction });
      break; // one entry per junction per route is the v1 contract
    }
  }
  return out.sort((p, q) => p.s - q.s);
}

export type StoppedMotion = {
  t0: number;
  duration: number;
  /** chained sub-plans; between consecutive plans the vehicle HOLDS at rest */
  plans: MotionPlan[];
  /** where and how long it held (diagnostic + the lamp-sync contract) */
  stops: Array<{ s: number; holdSeconds: number; junctionId: number }>;
};

/** The deterministic schedule WITH right-of-way: split at each controlled stop
 *  line whose gate holds us (stop sign always; signal only when not green at
 *  arrival), chain the sub-plans, hold between them. Sampling stays a pure
 *  function of t (sampleMotionWithStops). */
export function planMotionWithStops(points: [number, number][], opts: {
  startTime: number;
  profile: MotionProfile;
  junctions: readonly ControlledJunction[];
  stopLineMeters?: number;
}): StoppedMotion {
  const crossings = stopLineCrossings(points, opts.junctions, opts.stopLineMeters);
  const { cum, total } = measurePath(points);
  const plans: MotionPlan[] = [];
  const stops: StoppedMotion['stops'] = [];
  let segStartS = 0;
  let t = opts.startTime;
  let startSpeed = 0;
  for (const crossing of crossings) {
    if (crossing.s <= segStartS + 0.01 || crossing.s >= total - 0.01) continue;
    // would the gate hold us at our (unsplit) arrival time? Signals green at
    // arrival never split — traffic flows through on its own light.
    const probe = planMotion(slicePoints(points, cum, segStartS), { startTime: t, profile: opts.profile, startSpeed });
    const probeSample = probeArrival(probe, crossing.s - segStartS);
    if (junctionEntryDelay(crossing.junction, crossing.approach, t + probeSample) <= 0) continue;
    // we brake for the line, so the REAL arrival is the split leg's resting
    // end — the hold counts from there (the light may even have turned while
    // we braked; the split stands, the hold just shrinks to 0).
    const leg = planMotion(slicePoints(points, cum, segStartS, crossing.s), { startTime: t, profile: opts.profile, startSpeed });
    const hold = junctionEntryDelay(crossing.junction, crossing.approach, leg.t0 + leg.duration);
    plans.push(leg);
    stops.push({ s: crossing.s, holdSeconds: hold, junctionId: crossing.junction.box.id });
    t = leg.t0 + leg.duration + hold;
    segStartS = crossing.s;
    startSpeed = 0; // the split ends at rest — the full stop falls out
  }
  const last = planMotion(slicePoints(points, cum, segStartS), { startTime: t, profile: opts.profile, startSpeed });
  plans.push(last);
  return { t0: opts.startTime, duration: last.t0 + last.duration - opts.startTime, plans, stops };
}

/** seconds from a plan's start until it reaches arc length s (closed form
 *  over the plan's phases — the same math sampleMotion inverts; phase.t is
 *  plan-relative, matching sampleMotion's tau comparison) */
function probeArrival(plan: MotionPlan, s: number): number {
  if (s <= 0) return 0;
  for (const ph of plan.phases) {
    const sEnd = ph.s + ph.v * ph.dt + 0.5 * ph.a * ph.dt * ph.dt;
    if (s > sEnd + 1e-6) continue;
    const ds = s - ph.s;
    if (Math.abs(ph.a) < 1e-9) return ph.t + (ph.v > 1e-9 ? ds / ph.v : 0);
    const disc = Math.max(0, ph.v * ph.v + 2 * ph.a * ds);
    return ph.t + (Math.sqrt(disc) - ph.v) / ph.a;
  }
  return plan.duration;
}

/** Position at time t under a stop-gated schedule — a pure function of t:
 *  inside a hold the sample clamps to the leg's resting end. */
export function sampleMotionWithStops(m: StoppedMotion, t: number): MotionSample {
  let active = m.plans[0];
  for (const plan of m.plans) {
    if (plan.t0 <= t) active = plan;
    else break;
  }
  return sampleMotion(active, t);
}
