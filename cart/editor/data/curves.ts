// cart/editor/data/curves.ts — the everyday-curve helper kit (req_4319).
//
// Every helper is a pure function: parameters in, sampled points out. There are
// no resident curve objects, no handles to manage, no curve datatypes to learn —
// a helper's output is a plain polyline (Vec2[]/Vec3[]) or a ring stack
// (Vec3[][]) ready for the mesh document's ring-by-ring lathe/loft mechanics.
// That contract came out of the 2026-08-12 deep-research run
// (research_runs/2026-08-12__everyday-curves-modeling-algorithms/): the curve
// TAXONOMY lives in function names and presets; the REPRESENTATION stays points.
//
// Standing decisions encoded here, each traceable to the research synthesis:
//   · Outputs are arc-length-spaced by default (equal parameter steps are not
//     equal space steps; even spacing is what makes lofted quads uniform).
//   · curveThrough is centripetal Catmull-Rom — the only member of the family
//     that never cusps or self-intersects within a segment (Yuksel, CAD 2011).
//   · polyRound clamps every corner radius to the room its two segments give
//     it; the clamp IS the feature (unclamped fillets self-intersect).
//   · Curve offsetting is deliberately ABSENT — exact offsets are degree 10,
//     grow cusps wherever curvature reaches 1/distance, and no library has a
//     consensus method. When road/wall stamping needs insets, offset the
//     sampled polyline, not the curve.
//   · Transcendentals (catenary, clothoid, spirals) are sampled numerically;
//     they have no polynomial form and a mesh studio never needs one.
//
// Units are the caller's: helpers do pure geometry and never assume u vs m.

export type Vec2 = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };

export const CURVE_TUNING = {
  /** default samples for a short open curve (one arc, one bezier segment) */
  arcSamples: 24,
  /** default samples for a closed outline (ellipse, superellipse, egg) */
  outlineSamples: 64,
  /** default samples added per freeform segment in curveThrough */
  samplesPerSegment: 16,
  /** default points per fillet arc in polyRound */
  cornerSamples: 8,
  /** default rings per full revolution (15° per segment — smooth at prop scale, quad-loft friendly) */
  revolveSegments: 24,
  /** dense pre-sample multiple backing the arc-length resample contract */
  denseFactor: 4,
  /** dense pre-sample floor */
  denseMin: 64,
  /** conic fullness: below 0.5 elliptical, 0.5 parabolic, above hyperbolic */
  defaultRho: 0.4,
} as const;

const EPS = 1e-9;

// ── plumbing: length, tangents, resampling ─────────────────────────────────
// The arc-length LUT + linear reinterpolation below is the single sampling
// backbone: generators produce a dense polyline, then resample() spaces it
// evenly. This is the standard LUT approach (Peterson/Taligent); Gauss-Legendre
// exactness is CAD-interchange territory a polyline studio does not need.

type P = { x: number; y: number; z?: number };

function dist(a: P, b: P): number {
  const dx = b.x - a.x, dy = b.y - a.y, dz = (b.z ?? 0) - (a.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function lerpPt(a: P, b: P, t: number): P {
  const out: P = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  if (a.z !== undefined || b.z !== undefined) out.z = (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * t;
  return out;
}

export type PolylineInfo = {
  length: number;
  /** cumulative arc length at each point; cumulative[0] = 0, last = length */
  cumulative: number[];
  /** unit tangent per point (central difference at interior points) */
  tangents: P[];
  /** 2D-only: left-hand unit normal per point (undefined entries when input is 3D) */
  normals: (Vec2 | undefined)[];
};

/** The distance-along-the-polyline query surface: total length, per-point
 *  cumulative lengths, unit tangents, and (in 2D) left normals. */
export function polylineInfo(points: P[], opts: { closed?: boolean } = {}): PolylineInfo {
  const closed = opts.closed ?? false;
  const n = points.length;
  const cumulative: number[] = [0];
  for (let i = 1; i < n; i += 1) cumulative.push(cumulative[i - 1] + dist(points[i - 1], points[i]));
  const length = closed && n > 1 ? cumulative[n - 1] + dist(points[n - 1], points[0]) : cumulative[n - 1] ?? 0;
  const tangents: P[] = [];
  const normals: (Vec2 | undefined)[] = [];
  for (let i = 0; i < n; i += 1) {
    const prev = points[i === 0 ? (closed ? n - 1 : 0) : i - 1];
    const next = points[i === n - 1 ? (closed ? 0 : n - 1) : i + 1];
    const dx = next.x - prev.x, dy = next.y - prev.y, dz = (next.z ?? 0) - (prev.z ?? 0);
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const t: P = { x: dx / len, y: dy / len };
    if (points[i].z !== undefined) t.z = dz / len;
    tangents.push(t);
    normals.push(points[i].z === undefined ? { x: -dy / len, y: dx / len } : undefined);
  }
  return { length, cumulative, tangents, normals };
}

/** Re-space a polyline evenly along its own arc length. Pass n for an exact
 *  point count, or spacing for "even quads at any scale". Closed inputs wrap
 *  and come back without a duplicated seam point. */
export function resample(points: P[], opts: { n?: number; spacing?: number; closed?: boolean } = {}): P[] {
  const closed = opts.closed ?? false;
  if (points.length < 2) return points.slice();
  const ring = closed ? [...points, points[0]] : points;
  const cumulative: number[] = [0];
  for (let i = 1; i < ring.length; i += 1) cumulative.push(cumulative[i - 1] + dist(ring[i - 1], ring[i]));
  const total = cumulative[cumulative.length - 1];
  if (total < EPS) return points.slice();
  const count = opts.n ?? (opts.spacing ? Math.max(2, Math.round(total / opts.spacing) + (closed ? 0 : 1)) : points.length);
  const out: P[] = [];
  const spans = closed ? count : count - 1;
  let seg = 1;
  for (let i = 0; i < count; i += 1) {
    const target = (total * i) / spans;
    while (seg < ring.length - 1 && cumulative[seg] < target) seg += 1;
    const segLen = cumulative[seg] - cumulative[seg - 1];
    const t = segLen < EPS ? 0 : (target - cumulative[seg - 1]) / segLen;
    out.push(lerpPt(ring[seg - 1], ring[seg], t));
  }
  return out;
}

/** Dense-sample a parametric function then hand back n evenly spaced points.
 *  Every generator below routes through this to honor the even-spacing
 *  contract. Also exported directly as the analytic escape hatch. */
export function sampleFn(f: (t: number) => P, t0: number, t1: number, n: number, opts: { closed?: boolean } = {}): P[] {
  const closed = opts.closed ?? false;
  // a multiple of n so the requested points land ON dense samples, not on the
  // chords between them — analytic shapes stay exact at every output point
  const dense = n * Math.max(CURVE_TUNING.denseFactor, Math.ceil(CURVE_TUNING.denseMin / n));
  const raw: P[] = [];
  const spans = closed ? dense : dense - 1;
  for (let i = 0; i < dense; i += 1) raw.push(f(t0 + ((t1 - t0) * i) / spans));
  return resample(raw, { n, closed });
}

// ── tier 1: arcs and exact shapes (the sketch-CAD floor) ───────────────────

/** Circular arc through three points, from a to c passing through b.
 *  Collinear inputs degrade to the straight polyline a→c. */
export function arc3pt(a: Vec2, b: Vec2, c: Vec2, n: number = CURVE_TUNING.arcSamples): Vec2[] {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < EPS) return resample([a, c], { n }) as Vec2[];
  const aa = a.x * a.x + a.y * a.y, bb = b.x * b.x + b.y * b.y, cc = c.x * c.x + c.y * c.y;
  const cx = (aa * (b.y - c.y) + bb * (c.y - a.y) + cc * (a.y - b.y)) / d;
  const cy = (aa * (c.x - b.x) + bb * (a.x - c.x) + cc * (b.x - a.x)) / d;
  const r = Math.hypot(a.x - cx, a.y - cy);
  const angA = Math.atan2(a.y - cy, a.x - cx);
  const angB = Math.atan2(b.y - cy, b.x - cx);
  const angC = Math.atan2(c.y - cy, c.x - cx);
  const ccwTo = (from: number, to: number) => (to - from + Math.PI * 4) % (Math.PI * 2);
  // pick the sweep direction that meets b on the way from a to c
  const sweep = ccwTo(angA, angB) <= ccwTo(angA, angC) ? ccwTo(angA, angC) : ccwTo(angA, angC) - Math.PI * 2;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = angA + (sweep * i) / (n - 1);
    out.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
  }
  return out;
}

/** SVG-A-semantics arc: endpoints + radius, with the two flags picking among
 *  the four candidate arcs. A radius too small for the chord is scaled up to
 *  fit, exactly as the SVG spec does. */
export function arcTo(
  from: Vec2, to: Vec2, radius: number,
  opts: { largeArc?: boolean; sweep?: boolean } = {},
  n: number = CURVE_TUNING.arcSamples,
): Vec2[] {
  const largeArc = opts.largeArc ?? false;
  const sweep = opts.sweep ?? true;
  const mx = (from.x - to.x) / 2, my = (from.y - to.y) / 2;
  let r = Math.abs(radius);
  const lam = (mx * mx + my * my) / (r * r);
  if (lam > 1) r *= Math.sqrt(lam);
  const rr = r * r, mm = mx * mx + my * my;
  const factor = Math.sqrt(Math.max(0, (rr - mm) / mm)) * (largeArc !== sweep ? 1 : -1);
  const cx = factor * my + (from.x + to.x) / 2;
  const cy = -factor * mx + (from.y + to.y) / 2;
  const a0 = Math.atan2(from.y - cy, from.x - cx);
  const a1 = Math.atan2(to.y - cy, to.x - cx);
  let delta = a1 - a0;
  if (sweep && delta < 0) delta += Math.PI * 2;
  if (!sweep && delta > 0) delta -= Math.PI * 2;
  const out: Vec2[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = a0 + (delta * i) / (n - 1);
    out.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
  }
  return out;
}

/** Endpoint + bulge arc — "bow it out this much", the most artist-legible arc.
 *  Positive sag bulges to the left of the from→to direction. */
export function arcSag(from: Vec2, to: Vec2, sag: number, n: number = CURVE_TUNING.arcSamples): Vec2[] {
  if (Math.abs(sag) < EPS) return resample([from, to], { n }) as Vec2[];
  const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const nx = -(to.y - from.y) / len, ny = (to.x - from.x) / len;
  return arc3pt(from, { x: mx + nx * sag, y: my + ny * sag }, to, n);
}

/** Full or partial ellipse; rx === ry is the circle. Angles in degrees; the
 *  output is evenly spaced along the curve, not along the parameter. */
export function ellipseArc(
  center: Vec2, rx: number, ry: number,
  opts: { startDeg?: number; endDeg?: number; rotDeg?: number } = {},
  n: number = CURVE_TUNING.outlineSamples,
): Vec2[] {
  const a0 = ((opts.startDeg ?? 0) * Math.PI) / 180;
  const a1 = ((opts.endDeg ?? 360) * Math.PI) / 180;
  const rot = ((opts.rotDeg ?? 0) * Math.PI) / 180;
  const closed = Math.abs(Math.abs(a1 - a0) - Math.PI * 2) < EPS;
  const cr = Math.cos(rot), sr = Math.sin(rot);
  return sampleFn((t) => {
    const px = rx * Math.cos(t), py = ry * Math.sin(t);
    return { x: center.x + px * cr - py * sr, y: center.y + px * sr + py * cr };
  }, a0, a1, n, { closed }) as Vec2[];
}

/** The industrial-design cross-section curve (Fusion's Conic): endpoints, an
 *  apex the tangents aim at, and one fullness scalar. rho < 0.5 elliptical,
 *  0.5 exactly parabolic, > 0.5 hyperbolic. Implemented as the rational
 *  quadratic Bézier with weight rho/(1-rho) — the exact-conics fact that made
 *  NURBS the CAD standard, used here just to sample points. */
export function conic(
  from: Vec2, to: Vec2, apex: Vec2,
  rho: number = CURVE_TUNING.defaultRho,
  n: number = CURVE_TUNING.arcSamples,
): Vec2[] {
  const clamped = Math.min(1 - 1e-6, Math.max(1e-6, rho));
  const w = clamped / (1 - clamped);
  return sampleFn((t) => {
    const b0 = (1 - t) * (1 - t), b1 = 2 * (1 - t) * t * w, b2 = t * t;
    const den = b0 + b1 + b2;
    return { x: (b0 * from.x + b1 * apex.x + b2 * to.x) / den, y: (b0 * from.y + b1 * apex.y + b2 * to.y) / den };
  }, 0, 1, n) as Vec2[];
}

/** Lamé curve / squircle family: exp = 2 is the ellipse, 2.5 Piet Hein's
 *  superellipse, 4 the squircle, → ∞ the rectangle. One scalar continuously
 *  morphs roundness — the product-design outline knob. */
export function superellipse(
  a: number, b: number, exp: number = 2.5,
  n: number = CURVE_TUNING.outlineSamples,
): Vec2[] {
  const k = 2 / Math.max(exp, 1e-3);
  const shape = (c: number) => Math.sign(c) * Math.pow(Math.abs(c), k);
  // uniform-t clusters near the corners at high exponents; the resample inside
  // sampleFn is what makes the output usable (the research's superformula warning).
  return sampleFn((t) => ({ x: a * shape(Math.cos(t)), y: b * shape(Math.sin(t)) }), 0, Math.PI * 2, n, { closed: true }) as Vec2[];
}

// ── tier 2: freeform (the artist floor) ────────────────────────────────────

/** THE default freeform helper: an interpolating spline that passes through
 *  every input point. Centripetal Catmull-Rom converted per-segment to cubic
 *  Béziers — centripetal because it is the only parameterization in the family
 *  that cannot cusp or self-intersect inside a segment. tension scales the
 *  derived tangents: 1 is standard, 0 collapses to the straight polyline.
 *  Optional startTan/endTan aim the open ends; closed curves wrap. */
export function curveThrough(
  points: P[],
  opts: { closed?: boolean; tension?: number; startTan?: P; endTan?: P; samplesPerSegment?: number } = {},
): P[] {
  const closed = opts.closed ?? false;
  const tension = opts.tension ?? 1;
  const per = opts.samplesPerSegment ?? CURVE_TUNING.samplesPerSegment;
  const m = points.length;
  if (m < 2) return points.slice();
  if (m === 2 && !closed) return resample(points, { n: per + 1 });

  const ghostBefore = closed ? points[m - 1]
    : opts.startTan ? { x: points[0].x - opts.startTan.x, y: points[0].y - opts.startTan.y, ...(points[0].z !== undefined ? { z: (points[0].z ?? 0) - (opts.startTan.z ?? 0) } : {}) }
    : { x: points[0].x * 2 - points[1].x, y: points[0].y * 2 - points[1].y, ...(points[0].z !== undefined ? { z: (points[0].z ?? 0) * 2 - (points[1].z ?? 0) } : {}) };
  const ghostAfter = closed ? points[0]
    : opts.endTan ? { x: points[m - 1].x + opts.endTan.x, y: points[m - 1].y + opts.endTan.y, ...(points[m - 1].z !== undefined ? { z: (points[m - 1].z ?? 0) + (opts.endTan.z ?? 0) } : {}) }
    : { x: points[m - 1].x * 2 - points[m - 2].x, y: points[m - 1].y * 2 - points[m - 2].y, ...(points[m - 1].z !== undefined ? { z: (points[m - 1].z ?? 0) * 2 - (points[m - 2].z ?? 0) } : {}) };

  const ext: P[] = closed ? [points[m - 1], ...points, points[0], points[1] ?? points[0]] : [ghostBefore, ...points, ghostAfter];
  const segCount = closed ? m : m - 1;
  const out: P[] = [];

  const axis = (v: P, k: 0 | 1 | 2) => (k === 0 ? v.x : k === 1 ? v.y : v.z ?? 0);
  const has3 = points[0].z !== undefined;

  for (let s = 0; s < segCount; s += 1) {
    const p0 = ext[s], p1 = ext[s + 1], p2 = ext[s + 2], p3 = ext[s + 3];
    // centripetal knot spacing: dt = chord^0.5; coincident knots fall back to 1
    const dt0 = Math.sqrt(dist(p0, p1)) || 1;
    const dt1 = Math.sqrt(dist(p1, p2)) || 1;
    const dt2 = Math.sqrt(dist(p2, p3)) || 1;
    const tan = (k: 0 | 1 | 2, at: 'start' | 'end') => {
      if (at === 'start')
        return ((axis(p1, k) - axis(p0, k)) / dt0 - (axis(p2, k) - axis(p0, k)) / (dt0 + dt1) + (axis(p2, k) - axis(p1, k)) / dt1) * dt1 * tension;
      return ((axis(p2, k) - axis(p1, k)) / dt1 - (axis(p3, k) - axis(p1, k)) / (dt1 + dt2) + (axis(p3, k) - axis(p2, k)) / dt2) * dt1 * tension;
    };
    const h0: P = { x: p1.x + tan(0, 'start') / 3, y: p1.y + tan(1, 'start') / 3, ...(has3 ? { z: (p1.z ?? 0) + tan(2, 'start') / 3 } : {}) };
    const h1: P = { x: p2.x - tan(0, 'end') / 3, y: p2.y - tan(1, 'end') / 3, ...(has3 ? { z: (p2.z ?? 0) - tan(2, 'end') / 3 } : {}) };
    const last = s === segCount - 1;
    for (let i = 0; i < per + (last && !closed ? 1 : 0); i += 1) {
      const t = i / per;
      out.push(cubicPoint(p1, h0, h1, p2, t));
    }
  }
  return out;
}

function cubicPoint(p0: P, h0: P, h1: P, p1: P, t: number): P {
  const u = 1 - t;
  const b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
  const out: P = {
    x: b0 * p0.x + b1 * h0.x + b2 * h1.x + b3 * p1.x,
    y: b0 * p0.y + b1 * h0.y + b2 * h1.y + b3 * p1.y,
  };
  if (p0.z !== undefined || p1.z !== undefined)
    out.z = b0 * (p0.z ?? 0) + b1 * (h0.z ?? 0) + b2 * (h1.z ?? 0) + b3 * (p1.z ?? 0);
  return out;
}

/** One cubic Bézier segment with explicit handles — the expert path and the
 *  import target for SVG C data. Evenly spaced output. */
export function bezier(p0: P, h0: P, h1: P, p1: P, n: number = CURVE_TUNING.arcSamples): P[] {
  return sampleFn((t) => cubicPoint(p0, h0, h1, p1, t), 0, 1, n);
}

/** One quadratic Bézier (SVG Q data); degree-elevated to the cubic evaluator. */
export function bezierQuad(p0: P, c: P, p1: P, n: number = CURVE_TUNING.arcSamples): P[] {
  const h0 = lerpPt(p0, c, 2 / 3);
  const h1 = lerpPt(p1, c, 2 / 3);
  return bezier(p0, h0, h1, p1, n);
}

/** Polyline with circular-fillet corners — the rounded-rect generalization.
 *  Every corner radius is clamped to the room its two segments give it
 *  (r ≤ tan(θ/2) · half the shorter adjacent segment); the clamp is what keeps
 *  neighbouring fillets from colliding. Per-corner radii override the global. */
export function polyRound(
  points: Vec2[], radius: number,
  opts: { cornerSamples?: number; closed?: boolean; radii?: (number | undefined)[] } = {},
): Vec2[] {
  const closed = opts.closed ?? false;
  const cs = opts.cornerSamples ?? CURVE_TUNING.cornerSamples;
  const m = points.length;
  if (m < 3) return points.slice();
  const out: Vec2[] = [];
  const corners = closed ? m : m - 2;
  if (!closed) out.push(points[0]);
  for (let c = 0; c < corners; c += 1) {
    const i = closed ? c : c + 1;
    const prev = points[(i - 1 + m) % m], corner = points[i], next = points[(i + 1) % m];
    const inLen = dist(prev, corner), outLen = dist(corner, next);
    const ux = (corner.x - prev.x) / (inLen || 1), uy = (corner.y - prev.y) / (inLen || 1);
    const vx = (next.x - corner.x) / (outLen || 1), vy = (next.y - corner.y) / (outLen || 1);
    const cross = ux * vy - uy * vx;
    const dot = Math.min(1, Math.max(-1, ux * vx + uy * vy));
    const turn = Math.acos(dot);
    const want = opts.radii?.[i] ?? radius;
    if (Math.abs(cross) < 1e-6 || turn < 1e-6 || want <= 0) { out.push(corner); continue; }
    const halfInterior = (Math.PI - turn) / 2;
    // trim distance d = r/tan(θ/2), clamped to half of each adjacent segment
    let trim = want / Math.tan(halfInterior);
    const room = Math.min(inLen, outLen) / 2;
    if (trim > room) trim = room;
    const r = trim * Math.tan(halfInterior);
    const tinX = corner.x - ux * trim, tinY = corner.y - uy * trim;
    const toutX = corner.x + vx * trim, toutY = corner.y + vy * trim;
    out.push(...arcTo({ x: tinX, y: tinY }, { x: toutX, y: toutY }, r, { largeArc: false, sweep: cross > 0 }, cs));
  }
  if (!closed) out.push(points[m - 1]);
  return out;
}

// ── tier 3: specialty analytics (everyday-object closers) ──────────────────

/** The hanging-equilibrium curve through two endpoints with a requested sag
 *  (vertical drop below the chord at mid-span, gravity along -y). Flip the
 *  output for a pure-compression arch. The catenary parameter is solved by
 *  bisection — sag shrinks monotonically as the curve flattens. */
export function catenary(from: Vec2, to: Vec2, sag: number, n: number = CURVE_TUNING.arcSamples): Vec2[] {
  const dx = to.x - from.x;
  if (Math.abs(dx) < EPS || Math.abs(sag) < EPS) return resample([from, to], { n }) as Vec2[];
  const dy = to.y - from.y;
  const midX = (from.x + to.x) / 2;
  const chordMidY = (from.y + to.y) / 2;
  const fit = (a: number) => {
    const k = dx / (2 * a);
    const sinhK = Math.sinh(k);
    const mSpan = Math.abs(sinhK) < EPS ? 0 : Math.asinh(dy / (2 * a * sinhK));
    const x0 = midX - a * mSpan;
    const y0 = from.y - a * Math.cosh((from.x - x0) / a);
    return { x0, y0 };
  };
  const sagOf = (a: number) => {
    const { x0, y0 } = fit(a);
    return chordMidY - (a * Math.cosh((midX - x0) / a) + y0);
  };
  const span = Math.abs(dx);
  let lo = span / 1000, hi = span * 1000; // deep … flat
  for (let i = 0; i < 80; i += 1) {
    const mid = Math.sqrt(lo * hi);
    if (sagOf(mid) > Math.abs(sag)) lo = mid; else hi = mid;
  }
  const a = Math.sqrt(lo * hi);
  const { x0, y0 } = fit(a);
  const pts = sampleFn((x) => ({ x, y: a * Math.cosh((x - x0) / a) + y0 }), from.x, to.x, n) as Vec2[];
  if (sag < 0) for (const p of pts) p.y = 2 * (chordMidY + ((p.x - midX) / dx) * dy) - p.y; // mirror above the chord
  return pts;
}

/** Euler-spiral segment: curvature ramps linearly k0 → k1 over the given arc
 *  length — the constant-rate-of-steering transition that joins straights to
 *  arcs without a curvature jump. Starts at the origin heading +x; the output
 *  is intrinsically arc-length spaced. k is 1/radius, sign picks the side. */
export function clothoid(
  length: number, k0: number, k1: number,
  n: number = CURVE_TUNING.arcSamples,
  opts: { thetaDeg?: number } = {},
): Vec2[] {
  const theta0 = ((opts.thetaDeg ?? 0) * Math.PI) / 180;
  const theta = (s: number) => theta0 + k0 * s + ((k1 - k0) * s * s) / (2 * length);
  const steps = Math.max(256, n * 8);
  const h = length / steps;
  const trace: Vec2[] = [{ x: 0, y: 0 }];
  let x = 0, y = 0;
  for (let i = 0; i < steps; i += 1) {
    const tMid = theta((i + 0.5) * h); // midpoint rule keeps the drift tiny
    x += h * Math.cos(tMid);
    y += h * Math.sin(tMid);
    trace.push({ x, y });
  }
  const out: Vec2[] = [];
  for (let i = 0; i < n; i += 1) out.push(trace[Math.round((steps * i) / (n - 1))]);
  return out;
}

/** Circular helix around +y: plan radius, rise per revolution, turn count.
 *  Springs, threads, spiral ramps, stair rails. */
export function helix(
  radius: number, pitch: number, turns: number,
  n?: number,
): Vec3[] {
  const count = n ?? Math.max(2, Math.round(CURVE_TUNING.revolveSegments * turns));
  const out: Vec3[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = (Math.PI * 2 * turns * i) / (count - 1);
    out.push({ x: radius * Math.cos(t), y: (pitch * t) / (Math.PI * 2), z: radius * Math.sin(t) });
  }
  return out;
}

export type SpiralMode = 'log' | 'archimedean' | 'fermat';

/** The three everyday spirals: log (self-similar growth — shells, horns),
 *  archimedean (constant ring spacing — coils, springs, grooves), fermat
 *  (organic packing — seed heads). r(θ): a·e^(bθ) | a + bθ | a·√θ. */
export function spiral(
  mode: SpiralMode, a: number, b: number,
  opts: { turns?: number } = {},
  n: number = CURVE_TUNING.outlineSamples,
): Vec2[] {
  const turns = opts.turns ?? 3;
  const r = (t: number) => (mode === 'log' ? a * Math.exp(b * t) : mode === 'archimedean' ? a + b * t : a * Math.sqrt(t));
  return sampleFn((t) => ({ x: r(t) * Math.cos(t), y: r(t) * Math.sin(t) }), 0, Math.PI * 2 * turns, n) as Vec2[];
}

/** Hügelschäffer egg outline (closed, long axis on x): length, max breadth,
 *  and the axis shift that moves the fat end — the three directly measurable
 *  egg quantities. shift 0 is the ellipse; it is clamped inside ±0.49·length
 *  where the closed form stays real. */
export function egg(length: number, breadth: number, shift: number, n: number = CURVE_TUNING.outlineSamples): Vec2[] {
  const L = length, B = breadth;
  const w = Math.min(0.49 * L, Math.max(-0.49 * L, shift));
  const half = (x: number) => {
    const num = L * L - 4 * x * x;
    const den = L * L + 8 * w * x + 4 * w * w;
    return den < EPS ? 0 : (B / 2) * Math.sqrt(Math.max(0, num / den));
  };
  return sampleFn((t) => {
    // parameterize by angle so both tips are visited exactly once
    const x = (L / 2) * Math.cos(t);
    const y = half(x) * (Math.sin(t) >= 0 ? 1 : -1);
    return { x, y };
  }, 0, Math.PI * 2, n, { closed: true }) as Vec2[];
}

/** Teardrop / piriform outline (closed): x = cos t, y = sin t · sin^m(t/2),
 *  scaled by size. m controls pointiness; m = 2 is the classical pear quartic.
 *  Droplets, pears, seeds — one shape parameter. */
export function teardrop(m: number = 2, size: number = 1, n: number = CURVE_TUNING.outlineSamples): Vec2[] {
  return sampleFn((t) => ({
    x: size * Math.cos(t),
    y: size * Math.sin(t) * Math.pow(Math.sin(t / 2), m),
  }), 0, Math.PI * 2, n, { closed: true }) as Vec2[];
}

// ── tier 4: generators and plumbing (mesh-studio glue) ─────────────────────

/** Revolve a half-profile into a ring stack for the ring-by-ring lathe.
 *  Profile points are (radius, height); rings sweep around +y. Every ring
 *  carries the same point count so the stack lofts to clean quads; a zero
 *  radius collapses its ring to a pole naturally. Partial sweeps (angleDeg
 *  < 360) include both end seams. */
export function revolveRings(
  profile: Vec2[],
  opts: { segments?: number; angleDeg?: number } = {},
): Vec3[][] {
  const segments = opts.segments ?? CURVE_TUNING.revolveSegments;
  const angle = ((opts.angleDeg ?? 360) * Math.PI) / 180;
  const full = Math.abs(angle - Math.PI * 2) < EPS;
  const count = full ? segments : segments + 1;
  return profile.map((p) => {
    const ring: Vec3[] = [];
    for (let i = 0; i < count; i += 1) {
      const t = (angle * i) / (full ? segments : segments);
      ring.push({ x: p.x * Math.cos(t), y: p.y, z: p.x * Math.sin(t) });
    }
    return ring;
  });
}

/** Sweep a 2D cross-section along a 3D path into a ring stack. Frames are
 *  rotation-minimizing (double-reflection parallel transport) — no Frenet
 *  flips on straight runs. scaleAlong is Blender's taper as plain data (array
 *  resampled over the path, or a t→scale function); twistAlong the same in
 *  degrees. Profile x maps to the frame normal, y to the binormal. */
export function sweepRings(
  profile: Vec2[], path: Vec3[],
  opts: {
    scaleAlong?: number[] | ((t: number) => number);
    twistAlong?: number[] | ((t: number) => number);
  } = {},
): Vec3[][] {
  const m = path.length;
  if (m < 2) return [];
  const channel = (src: number[] | ((t: number) => number) | undefined, t: number, fallback: number): number => {
    if (!src) return fallback;
    if (typeof src === 'function') return src(t);
    if (src.length === 0) return fallback;
    const f = t * (src.length - 1);
    const i = Math.min(src.length - 2, Math.floor(f));
    return src[i] + (src[i + 1] - src[i]) * (f - i);
  };
  const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const dot3 = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
  const norm3 = (v: Vec3): Vec3 => { const l = Math.sqrt(dot3(v, v)) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
  const tangents: Vec3[] = [];
  for (let i = 0; i < m; i += 1)
    tangents.push(norm3(sub(path[Math.min(m - 1, i + 1)], path[Math.max(0, i - 1)])));
  // first frame: an up-vector least aligned with the first tangent
  const t0 = tangents[0];
  const seed: Vec3 = Math.abs(t0.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  let normal = norm3({ x: seed.x - t0.x * dot3(seed, t0), y: seed.y - t0.y * dot3(seed, t0), z: seed.z - t0.z * dot3(seed, t0) });
  const rings: Vec3[][] = [];
  for (let i = 0; i < m; i += 1) {
    if (i > 0) {
      // double-reflection parallel transport of the previous normal
      const v1 = sub(path[i], path[i - 1]);
      const c1 = dot3(v1, v1);
      if (c1 > EPS) {
        const rl: Vec3 = {
          x: normal.x - (2 * dot3(v1, normal) / c1) * v1.x,
          y: normal.y - (2 * dot3(v1, normal) / c1) * v1.y,
          z: normal.z - (2 * dot3(v1, normal) / c1) * v1.z,
        };
        const tPrevRef: Vec3 = {
          x: tangents[i - 1].x - (2 * dot3(v1, tangents[i - 1]) / c1) * v1.x,
          y: tangents[i - 1].y - (2 * dot3(v1, tangents[i - 1]) / c1) * v1.y,
          z: tangents[i - 1].z - (2 * dot3(v1, tangents[i - 1]) / c1) * v1.z,
        };
        const v2 = sub(tangents[i], tPrevRef);
        const c2 = dot3(v2, v2);
        normal = c2 > EPS ? {
          x: rl.x - (2 * dot3(v2, rl) / c2) * v2.x,
          y: rl.y - (2 * dot3(v2, rl) / c2) * v2.y,
          z: rl.z - (2 * dot3(v2, rl) / c2) * v2.z,
        } : rl;
        normal = norm3(normal);
      }
    }
    const tHere = tangents[i];
    const binormal: Vec3 = {
      x: tHere.y * normal.z - tHere.z * normal.y,
      y: tHere.z * normal.x - tHere.x * normal.z,
      z: tHere.x * normal.y - tHere.y * normal.x,
    };
    const u = m === 1 ? 0 : i / (m - 1);
    const scale = channel(opts.scaleAlong, u, 1);
    const twist = (channel(opts.twistAlong, u, 0) * Math.PI) / 180;
    const ct = Math.cos(twist), st = Math.sin(twist);
    rings.push(profile.map((p) => {
      const px = (p.x * ct - p.y * st) * scale;
      const py = (p.x * st + p.y * ct) * scale;
      return {
        x: path[i].x + normal.x * px + binormal.x * py,
        y: path[i].y + normal.y * px + binormal.y * py,
        z: path[i].z + normal.z * px + binormal.z * py,
      };
    }));
  }
  return rings;
}

// ── presets: the everyday objects by name ──────────────────────────────────

export type ArchFamily = 'semicircular' | 'segmental' | 'gothic' | 'parabolic' | 'catenary';

/** Arch profiles from left springing (-span/2, 0) to right (+span/2, 0), y up.
 *  Families follow how masons actually strike them: semicircular ignores rise
 *  (it IS span/2 by definition); segmental is the arc through springings and
 *  apex; gothic is two arcs from centers on the springing line meeting in a
 *  point; parabolic is the uniform-load shape; catenary the pure-compression
 *  one (a true inverted cosh solved for the apex rise, not a lookalike). */
export function arch(family: ArchFamily, span: number, rise: number, n: number = CURVE_TUNING.outlineSamples): Vec2[] {
  const s = span / 2;
  const left: Vec2 = { x: -s, y: 0 }, right: Vec2 = { x: s, y: 0 };
  switch (family) {
    case 'semicircular':
      return arc3pt(left, { x: 0, y: s }, right, n);
    case 'segmental':
      return arc3pt(left, { x: 0, y: rise }, right, n);
    case 'gothic': {
      // the two-centered strike (centers on the springing line) only exists for
      // rise > span/2 — below that the struck arc would bulge above its own
      // apex, which no mason draws; shallower asks fall back to the segmental
      if (rise <= s) return arc3pt(left, { x: 0, y: rise }, right, n);
      const c = (rise * rise - s * s) / (2 * s); // center of the LEFT arc at (+c, 0)
      const r = c + s;
      const half = Math.max(2, Math.floor(n / 2));
      const leftArc = sampleFn((t) => {
        const a0 = Math.atan2(0, -s - c); // angle of left springing about (c, 0)
        const a1 = Math.atan2(rise, -c); // angle of apex about (c, 0)
        const a = a0 + (a1 - a0) * t;
        return { x: c + r * Math.cos(a), y: r * Math.sin(a) };
      }, 0, 1, half) as Vec2[];
      const rightArc = leftArc.map((p) => ({ x: -p.x, y: p.y })).reverse();
      return [...leftArc, ...rightArc.slice(1)];
    }
    case 'parabolic':
      return sampleFn((x) => ({ x, y: rise * (1 - (x * x) / (s * s)) }), -s, s, n) as Vec2[];
    case 'catenary': {
      // solve the catenary parameter so the apex sits exactly at the rise
      let lo = s / 1000, hi = s * 1000;
      for (let i = 0; i < 80; i += 1) {
        const mid = Math.sqrt(lo * hi);
        if (mid * (Math.cosh(s / mid) - 1) > rise) lo = mid; else hi = mid;
      }
      const a = Math.sqrt(lo * hi);
      return sampleFn((x) => ({ x, y: rise - a * (Math.cosh(x / a) - 1) }), -s, s, n) as Vec2[];
    }
  }
}

export type VesselStation = { radius: number; height: number };

/** Station-based vessel profile — the potter's vocabulary (foot, belly,
 *  shoulder, neck, lip) as data: radii at heights, splined through with the
 *  interpolating freeform so every station is hit exactly. Feed the result to
 *  revolveRings for the bowl/vase/bottle. Stations are sorted by height so
 *  callers can list them in any order. */
export function vesselProfile(stations: VesselStation[], opts: { samplesPerSegment?: number } = {}): Vec2[] {
  const sorted = [...stations].sort((a, b) => a.height - b.height);
  return curveThrough(
    sorted.map((st) => ({ x: Math.max(0, st.radius), y: st.height })),
    { samplesPerSegment: opts.samplesPerSegment ?? CURVE_TUNING.samplesPerSegment },
  ).map((p) => ({ x: Math.max(0, p.x), y: p.y }));
}
