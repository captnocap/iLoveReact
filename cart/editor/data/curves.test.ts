// cart/editor/data/curves.test.ts — the everyday-curve helper kit (req_4319).
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/data/curves.test.ts --bundle \
//     --outfile=/tmp/editor-curves.test.js --format=iife --platform=neutral \
//     --target=es2022
//   tools/v8cli /tmp/editor-curves.test.js

import {
  arc3pt, arcTo, arcSag, ellipseArc, conic, superellipse,
  curveThrough, bezier, bezierQuad, polyRound, sampleFn,
  catenary, clothoid, helix, spiral, egg, teardrop,
  revolveRings, sweepRings, resample, polylineInfo,
  arch, vesselProfile,
  type Vec2, type Vec3,
} from './curves';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(s + '\n'));
function test(name: string, fn: () => void) {
  try { fn(); passed++; log(`  ok  ${name}`); }
  catch (e) { failed++; log(`FAIL  ${name}: ${(e as Error).message}`); }
}
function expect(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
function near(a: number, b: number, tol = 1e-6) { return Math.abs(a - b) <= tol; }
function ptNear(p: { x: number; y: number; z?: number }, q: { x: number; y: number; z?: number }, tol = 1e-6) {
  return near(p.x, q.x, tol) && near(p.y, q.y, tol) && near(p.z ?? 0, q.z ?? 0, tol);
}
function allFinite(pts: { x: number; y: number; z?: number }[]) {
  return pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z ?? 0));
}
function minDistTo(pts: Vec2[], q: Vec2) {
  return Math.min(...pts.map((p) => Math.hypot(p.x - q.x, p.y - q.y)));
}

// ── tier 1: arcs and exact shapes ──────────────────────────────────────────

test('arc3pt passes through all three points at constant radius', () => {
  const a = { x: -1, y: 0 }, b = { x: 0, y: 1 }, c = { x: 1, y: 0 };
  const pts = arc3pt(a, b, c, 33);
  expect(ptNear(pts[0], a) && ptNear(pts[32], c), 'endpoints are exact');
  expect(minDistTo(pts, b) < 0.01, 'the middle point is on the arc');
  const radii = pts.map((p) => Math.hypot(p.x, p.y));
  expect(radii.every((r) => near(r, 1, 1e-9)), 'every sample sits on the unit circle');
});

test('arc3pt collinear inputs degrade to the straight chord', () => {
  const pts = arc3pt({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, 5);
  expect(allFinite(pts), 'no NaN on the degenerate case');
  expect(pts.every((p) => near(p.y, 0)), 'all samples on the line');
});

test('arcTo hits both endpoints and honors the radius', () => {
  const from = { x: 0, y: 0 }, to = { x: 2, y: 0 };
  const pts = arcTo(from, to, 1.25, { sweep: true }, 17);
  expect(ptNear(pts[0], from) && ptNear(pts[16], to), 'endpoints are exact');
  const info = polylineInfo(pts);
  expect(info.length > 2, 'the arc is longer than the chord');
});

test('arcTo four flag combinations give four distinct arcs', () => {
  const from = { x: 0, y: 0 }, to = { x: 2, y: 0 };
  const mids = [
    arcTo(from, to, 1.25, { largeArc: false, sweep: true }, 9)[4],
    arcTo(from, to, 1.25, { largeArc: false, sweep: false }, 9)[4],
    arcTo(from, to, 1.25, { largeArc: true, sweep: true }, 9)[4],
    arcTo(from, to, 1.25, { largeArc: true, sweep: false }, 9)[4],
  ];
  for (let i = 0; i < 4; i += 1)
    for (let j = i + 1; j < 4; j += 1)
      expect(!ptNear(mids[i], mids[j], 1e-3), `arc ${i} differs from arc ${j}`);
});

test('arcSag bulges by exactly the requested sag', () => {
  const pts = arcSag({ x: 0, y: 0 }, { x: 4, y: 0 }, 0.75, 33);
  const apex = Math.max(...pts.map((p) => p.y));
  expect(near(apex, 0.75, 1e-3), `apex ${apex} ≈ 0.75`);
});

test('ellipseArc with rx === ry is the circle, evenly spaced', () => {
  const pts = ellipseArc({ x: 3, y: -2 }, 2, 2, {}, 48) as Vec2[];
  expect(pts.every((p) => near(Math.hypot(p.x - 3, p.y + 2), 2, 1e-6)), 'all on the circle');
  const gaps: number[] = [];
  for (let i = 1; i < pts.length; i += 1) gaps.push(Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const spread = Math.max(...gaps) - Math.min(...gaps);
  expect(spread < 0.02, 'spacing is even around the ring');
});

test('conic at rho 0.5 is the parabola of its quadratic Bezier', () => {
  const from = { x: -1, y: 0 }, to = { x: 1, y: 0 }, apex = { x: 0, y: 1 };
  const pts = conic(from, to, apex, 0.5, 25);
  const quad = bezierQuad(from, apex, to, 25);
  for (const p of pts) expect(minDistTo(quad as Vec2[], p) < 0.01, 'conic sample lies on the parabola');
});

test('conic fullness ordering: bigger rho pulls the shoulder toward the apex', () => {
  const from = { x: -1, y: 0 }, to = { x: 1, y: 0 }, apex = { x: 0, y: 1 };
  const shoulderY = (rho: number) => Math.max(...conic(from, to, apex, rho, 33).map((p) => p.y));
  expect(shoulderY(0.2) < shoulderY(0.5) && shoulderY(0.5) < shoulderY(0.8), 'monotone in rho');
});

test('superellipse exponent 2 is the ellipse; higher exponents grow the corner', () => {
  const ell = superellipse(2, 1, 2, 64);
  expect(ell.every((p) => near((p.x * p.x) / 4 + p.y * p.y, 1, 1e-2)), 'exp 2 satisfies the ellipse equation');
  const cornerReach = (e: number) => Math.max(...superellipse(1, 1, e, 128).map((p) => Math.hypot(p.x, p.y)));
  expect(cornerReach(4) > cornerReach(2.5) && cornerReach(2.5) > cornerReach(2), 'corners fill out as exp rises');
});

// ── tier 2: freeform ───────────────────────────────────────────────────────

test('curveThrough interpolates every knot exactly (open)', () => {
  const knots: Vec2[] = [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 3, y: 1 }, { x: 4, y: 3 }];
  const pts = curveThrough(knots) as Vec2[];
  for (const k of knots) expect(minDistTo(pts, k) < 1e-9, `knot (${k.x},${k.y}) is on the curve`);
  expect(ptNear(pts[0], knots[0]) && ptNear(pts[pts.length - 1], knots[3]), 'ends are the end knots');
});

test('curveThrough closed wraps without a seam duplicate and hits knots', () => {
  const knots: Vec2[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];
  const pts = curveThrough(knots, { closed: true }) as Vec2[];
  for (const k of knots) expect(minDistTo(pts, k) < 1e-9, 'knot on closed curve');
  expect(!ptNear(pts[0], pts[pts.length - 1]), 'no duplicated seam point');
});

test('curveThrough survives the classic uneven-spacing case without exploding', () => {
  // uniform Catmull-Rom cusps/loops here; centripetal must stay tame and finite
  const knots: Vec2[] = [{ x: 0, y: 0 }, { x: 0.1, y: 0.05 }, { x: 5, y: 0 }, { x: 5.1, y: 4 }];
  const pts = curveThrough(knots) as Vec2[];
  expect(allFinite(pts), 'finite everywhere');
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  expect(Math.min(...xs) > -1 && Math.max(...xs) < 6.2 && Math.min(...ys) > -2 && Math.max(...ys) < 5, 'stays near the control polygon');
});

test('curveThrough tension 0 collapses to the polyline', () => {
  const knots: Vec2[] = [{ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 4, y: 0 }];
  const pts = curveThrough(knots, { tension: 0 }) as Vec2[];
  for (const p of pts) {
    const onLeft = Math.abs(p.y - p.x) < 1e-6 && p.x <= 2 + 1e-9;
    const onRight = Math.abs(p.y - (4 - p.x)) < 1e-6 && p.x >= 2 - 1e-9;
    expect(onLeft || onRight, 'every sample sits on a polyline leg');
  }
});

test('bezier endpoints and midpoint match the closed form', () => {
  const pts = bezier({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 0 }, 25) as Vec2[];
  expect(ptNear(pts[0], { x: 0, y: 0 }) && ptNear(pts[24], { x: 2, y: 0 }), 'endpoints exact');
  expect(minDistTo(pts, { x: 1, y: 0.75 }) < 0.01, 't=0.5 point (1, 0.75) is on the curve');
});

test('polyRound rounds a square and clamps an oversized radius sanely', () => {
  const square: Vec2[] = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }];
  const rounded = polyRound(square, 1, { closed: true });
  expect(allFinite(rounded), 'finite output');
  expect(minDistTo(rounded, { x: 0, y: 0 }) > 0.25, 'the sharp corner is cut away');
  expect(rounded.every((p) => p.x > -1e-9 && p.x < 4 + 1e-9 && p.y > -1e-9 && p.y < 4 + 1e-9), 'stays inside the square');
  const over = polyRound(square, 50, { closed: true });
  expect(allFinite(over), 'oversized radius clamps instead of exploding');
});

test('sampleFn spaces an analytic curve evenly', () => {
  const pts = sampleFn((t) => ({ x: t, y: t * t }), 0, 2, 21);
  const gaps: number[] = [];
  for (let i = 1; i < pts.length; i += 1) gaps.push(Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  expect(Math.max(...gaps) / Math.min(...gaps) < 1.1, 'gap ratio under 10%');
});

// ── tier 3: specialty analytics ────────────────────────────────────────────

test('catenary hits its endpoints and sags by the requested amount', () => {
  const from = { x: 0, y: 0 }, to = { x: 10, y: 0 };
  const pts = catenary(from, to, 2, 41);
  expect(ptNear(pts[0], from, 1e-3) && ptNear(pts[40], to, 1e-3), 'endpoints hit');
  const low = Math.min(...pts.map((p) => p.y));
  expect(near(low, -2, 0.01), `sag ${low} ≈ -2`);
});

test('catenary with unequal endpoint heights still lands both ends', () => {
  const from = { x: 0, y: 0 }, to = { x: 8, y: 3 };
  const pts = catenary(from, to, 1.5, 41);
  expect(ptNear(pts[0], from, 1e-3) && ptNear(pts[40], to, 1e-3), 'tilted chord endpoints hit');
  expect(allFinite(pts), 'finite everywhere');
});

test('clothoid at constant curvature is a circular arc', () => {
  const k = 0.5; // radius 2
  const pts = clothoid(Math.PI, k, k, 33); // quarter of the circumference 2πr = 4π
  // circle of radius 2 centered at (0, 2)
  expect(pts.every((p) => near(Math.hypot(p.x, p.y - 2), 2, 1e-3)), 'all samples on the radius-2 circle');
});

test('clothoid at zero curvature is the straight line of its length', () => {
  const pts = clothoid(5, 0, 0, 11);
  expect(ptNear(pts[10], { x: 5, y: 0 }, 1e-6), 'ends at (length, 0)');
  expect(pts.every((p) => near(p.y, 0)), 'never leaves the axis');
});

test('clothoid curvature actually ramps: end of the ramp bends harder than the start', () => {
  const pts = clothoid(4, 0, 1, 65);
  const turnAt = (i: number) => {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    return Math.abs(Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x));
  };
  expect(turnAt(60) > turnAt(4) * 4, 'discrete turning grows along the spiral');
});

test('helix rises by pitch per revolution at constant radius', () => {
  const pts = helix(2, 1.5, 3, 73);
  expect(pts.every((p) => near(Math.hypot(p.x, p.z), 2, 1e-9)), 'constant plan radius');
  expect(near(pts[72].y, 4.5, 1e-9), 'three turns rise 3 × pitch');
  expect(near(pts[24].y, 1.5, 1e-9), 'one turn rises exactly the pitch');
});

test('log spiral grows by e^(2πb) per turn; archimedean by 2πb', () => {
  const lg = spiral('log', 1, 0.2, { turns: 2 }, 129);
  const rEnd = Math.hypot(lg[128].x, lg[128].y);
  expect(near(rEnd, Math.exp(0.2 * Math.PI * 4), 0.05), 'log growth ratio');
  const ar = spiral('archimedean', 0, 1, { turns: 2 }, 129);
  expect(near(Math.hypot(ar[128].x, ar[128].y), Math.PI * 4, 0.05), 'archimedean end radius');
});

test('egg is breadth-wide at center, closes at both tips, and shift moves the fat end', () => {
  const pts = egg(4, 2.4, 0.5, 128);
  expect(allFinite(pts), 'finite outline');
  const maxY = Math.max(...pts.map((p) => p.y));
  expect(near(maxY, 1.2, 0.05), 'half-breadth at the widest');
  expect(minDistTo(pts, { x: 2, y: 0 }) < 0.08 && minDistTo(pts, { x: -2, y: 0 }) < 0.08, 'both tips reached');
  const widthAtMinus1 = Math.max(...pts.filter((p) => Math.abs(p.x + 1) < 0.1).map((p) => p.y));
  const widthAtPlus1 = Math.max(...pts.filter((p) => Math.abs(p.x - 1) < 0.1).map((p) => p.y));
  expect(widthAtMinus1 > widthAtPlus1, 'positive shift fattens the negative-x end');
});

test('teardrop closes and is symmetric about its axis', () => {
  const pts = teardrop(2, 1, 96);
  expect(allFinite(pts), 'finite outline');
  const maxY = Math.max(...pts.map((p) => p.y));
  const minY = Math.min(...pts.map((p) => p.y));
  expect(near(maxY, -minY, 1e-2), 'mirror symmetric across the x axis');
});

// ── tier 4: generators and plumbing ────────────────────────────────────────

test('revolveRings makes one ring per profile point at the profile radius', () => {
  const profile: Vec2[] = [{ x: 1, y: 0 }, { x: 2, y: 1 }, { x: 0.5, y: 2 }];
  const rings = revolveRings(profile, { segments: 12 });
  expect(rings.length === 3, 'ring per profile point');
  expect(rings.every((r) => r.length === 12), 'segment count everywhere');
  rings.forEach((r, i) => {
    expect(r.every((p) => near(Math.hypot(p.x, p.z), profile[i].x, 1e-9)), `ring ${i} at radius ${profile[i].x}`);
    expect(r.every((p) => near(p.y, profile[i].y, 1e-9)), `ring ${i} at height ${profile[i].y}`);
  });
});

test('revolveRings partial sweep includes both seam columns', () => {
  const rings = revolveRings([{ x: 1, y: 0 }], { segments: 8, angleDeg: 180 });
  expect(rings[0].length === 9, 'partial sweep carries segments + 1 points');
  expect(ptNear(rings[0][0], { x: 1, y: 0, z: 0 }) && ptNear(rings[0][8], { x: -1, y: 0, z: 0 }, 1e-9), 'seams at 0° and 180°');
});

test('sweepRings along a straight vertical path is a cylinder', () => {
  const circle = ellipseArc({ x: 0, y: 0 }, 1, 1, {}, 12) as Vec2[];
  const path: Vec3[] = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 2, z: 0 }];
  const rings = sweepRings(circle, path);
  expect(rings.length === 3 && rings.every((r) => r.length === 12), 'ring per path point');
  for (const ring of rings)
    for (const p of ring) expect(near(Math.hypot(p.x, p.z), 1, 1e-6), 'cylinder wall at radius 1');
});

test('sweepRings scaleAlong tapers the far end', () => {
  const circle = ellipseArc({ x: 0, y: 0 }, 1, 1, {}, 8) as Vec2[];
  const path: Vec3[] = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 2, z: 0 }];
  const rings = sweepRings(circle, path, { scaleAlong: [1, 0.5, 0.1] });
  const radiusOf = (ring: Vec3[]) => Math.max(...ring.map((p) => Math.hypot(p.x, p.z)));
  expect(near(radiusOf(rings[0]), 1, 1e-6) && near(radiusOf(rings[2]), 0.1, 1e-6), 'taper channel applied');
});

test('sweepRings frames do not flip around a bend', () => {
  const circle = ellipseArc({ x: 0, y: 0 }, 0.2, 0.2, {}, 8) as Vec2[];
  const path: Vec3[] = [];
  for (let i = 0; i <= 20; i += 1) {
    const t = (i / 20) * Math.PI;
    path.push({ x: Math.sin(t) * 3, y: (i / 20) * 2, z: Math.cos(t) * 3 });
  }
  const rings = sweepRings(circle, path);
  for (let i = 1; i < rings.length; i += 1) {
    const a = rings[i - 1][0], b = rings[i][0];
    expect(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) < 1.2, 'corresponding ring points move smoothly (no flip jump)');
  }
});

test('resample spaces points evenly and preserves total length', () => {
  const jagged: Vec2[] = [{ x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 3 }];
  const even = resample(jagged, { n: 17 });
  const info = polylineInfo(even);
  expect(near(info.length, 8, 1e-6), 'length preserved on a polyline resample');
  const gaps: number[] = [];
  for (let i = 1; i < even.length; i += 1) gaps.push(info.cumulative[i] - info.cumulative[i - 1]);
  expect(Math.max(...gaps) / Math.min(...gaps) < 1.001, 'even gaps');
});

test('resample by spacing yields the count the spacing implies', () => {
  const line: Vec2[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
  const even = resample(line, { spacing: 1 });
  expect(even.length === 11, `spacing 1 over length 10 gives 11 points, got ${even.length}`);
});

test('polylineInfo reports length, unit tangents, and left normals', () => {
  const info = polylineInfo([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }]);
  expect(near(info.length, 7), 'L-shape length 7');
  expect(near(Math.hypot(info.tangents[0].x, info.tangents[0].y), 1), 'unit tangent');
  expect(info.normals[0] !== undefined && near(info.normals[0]!.y, 1), 'left normal of +x travel is +y');
});

// ── presets ────────────────────────────────────────────────────────────────

test('every arch family lands the springings; risers hit the apex', () => {
  const families = ['semicircular', 'segmental', 'gothic', 'parabolic', 'catenary'] as const;
  for (const f of families) {
    const pts = arch(f, 4, 1.5, 65);
    expect(allFinite(pts), `${f} finite`);
    expect(minDistTo(pts, { x: -2, y: 0 }) < 0.05 && minDistTo(pts, { x: 2, y: 0 }) < 0.05, `${f} lands both springings`);
    const apex = Math.max(...pts.map((p) => p.y));
    if (f === 'semicircular') expect(near(apex, 2, 0.02), 'semicircular apex is span/2 by definition');
    else expect(near(apex, 1.5, 0.05), `${f} apex ≈ rise`);
  }
});

test('gothic arch peaks in a point: apex sits above a straight two-arc joint', () => {
  const pts = arch('gothic', 4, 2.6, 129);
  const apexIdx = pts.reduce((best, p, i) => (p.y > pts[best].y ? i : best), 0);
  const a = pts[apexIdx - 2], b = pts[apexIdx + 2];
  expect(near(a.y, b.y, 0.05), 'flanks are symmetric around the point');
  expect(pts[apexIdx].y > (a.y + b.y) / 2 + 1e-4, 'the apex is a peak, not a flat');
});

test('vesselProfile passes through its stations regardless of listing order', () => {
  const stations = [
    { radius: 1.2, height: 3 }, // lip
    { radius: 0.4, height: 0 }, // foot
    { radius: 1.6, height: 1 }, // belly
    { radius: 0.7, height: 2.4 }, // neck
  ];
  const profile = vesselProfile(stations);
  for (const st of stations) expect(minDistTo(profile, { x: st.radius, y: st.height }) < 1e-6, `station r=${st.radius} h=${st.height} hit`);
  expect(profile.every((p) => p.x >= 0), 'radii never go negative');
});

test('the bowl pipeline: vessel profile → revolveRings is loft-ready', () => {
  const profile = vesselProfile([
    { radius: 0.5, height: 0 },
    { radius: 2, height: 0.8 },
    { radius: 2.4, height: 1.6 },
  ]);
  const rings = revolveRings(profile, { segments: 16 });
  expect(rings.length === profile.length, 'one ring per profile sample');
  expect(rings.every((r) => r.length === 16), 'constant ring width for quad lofting');
  expect(rings.every((r) => allFinite(r)), 'finite mesh data');
});

log('');
log(`curves: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
