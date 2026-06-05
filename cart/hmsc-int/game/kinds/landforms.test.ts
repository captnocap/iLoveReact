// Behavior tests for the landform registry (P4): assert what the terrain DOES
// — summit heights, walkable benches, crater water, painted grids sampled 1:1.

import {
  LANDFORM_KIND_DEFINITIONS,
  LANDFORM_KINDS,
  LANDFORM_TUNING,
  landformKindDefinition,
  landformRoadCenterline,
  landformRoadHalfWidth,
  landformSurfaceTop,
  mountainCraterLake,
  mountainTrailheadPoint,
  type LandformField,
  type LandformInstance,
} from './landforms';
import { assert, assertClose, assertEqual, finish, test } from '../_testkit';

const def = (kind: string) => {
  const d = landformKindDefinition(kind);
  if (!d) throw new Error(`kind ${kind} not registered`);
  return d;
};

test('the four built-in kinds are registered; unknown kinds resolve undefined', () => {
  assertEqual(LANDFORM_KINDS.join(','), 'hills,mountain,estate,heightfield', 'registered kinds');
  assertEqual(landformKindDefinition('volcano'), undefined, 'unknown kind');
  for (const k of LANDFORM_KINDS) {
    const d = LANDFORM_KIND_DEFINITIONS[k];
    assertEqual(d.kind, k, `${k} kind field`);
    assert(d.walkCos(d.defaults) > 0 && d.walkCos(d.defaults) < 1, `${k} walk limit is a real slope`);
  }
});

// ── hills ────────────────────────────────────────────────────────────────────

test('hills roll inside the patch and fade to flat ground at its edge', () => {
  const h = def('hills');
  const p = { ...h.defaults };
  let peakSeen = 0;
  for (let r = 0; r <= p.halfWidth; r += 5) {
    const rise = h.rise(p, r, 0);
    assert(rise >= 0, `hills never dig below grade (r=${r})`);
    peakSeen = Math.max(peakSeen, rise);
  }
  assert(peakSeen > 0, 'hills actually rise somewhere');
  assertClose(h.rise(p, p.halfWidth, 0), 0, 1e-9, 'edge of the patch is flat');
  assertClose(h.rise(p, p.halfWidth + 10, 0), 0, 1e-9, 'beyond the patch is flat');
});

test('hills are deterministic per seed and reshape with it', () => {
  const h = def('hills');
  const a = h.rise({ ...h.defaults, seed: 7 }, 12, -9);
  const b = h.rise({ ...h.defaults, seed: 7 }, 12, -9);
  const c = h.rise({ ...h.defaults, seed: 8 }, 12, -9);
  assertEqual(a, b, 'same seed, same ground');
  assert(a !== c, 'different seed, different ground');
});

// ── mountain ─────────────────────────────────────────────────────────────────

test('mountain summit is a crater: floor sits craterDepth below the peak', () => {
  const m = def('mountain');
  const p = { ...m.defaults };
  const T = LANDFORM_TUNING.mountain;
  assertClose(m.rise(p, 0, 0), p.peak - T.craterDepthMeters, 1e-9, 'crater floor at center');
  // The rim carries the full peak — approach just outside the trail bench's
  // reach by sampling the cone face at the rim radius opposite the trailhead.
  assertClose(m.rise(p, -T.craterRimRadiusMeters, 0), p.peak, 0.5, 'crater rim near peak');
  assertClose(m.rise(p, p.baseRadius + T.trailHalfWidthMeters + 1, 0), 0, 1e-9, 'flat beyond the footprint');
});

test('the spiral trail is a flat bench rising 0 → peak from trailhead to rim', () => {
  const m = def('mountain');
  const p = { ...m.defaults };
  const lf: LandformInstance = { kind: 'mountain', centerX: 0, centerZ: 0, baseY: 0, params: p };
  const head = mountainTrailheadPoint(lf);
  assertClose(m.rise(p, head.x, head.z), 0, 1e-6, 'trailhead (u=0) sits at grade');
  // Walking the spiral centerline, height is peak*u — strictly rising.
  const T = LANDFORM_TUNING.mountain;
  let prev = -1;
  for (let s = 0; s <= 10; s += 1) {
    const u = s / 10;
    const radius = p.baseRadius - (p.baseRadius - T.craterRimRadiusMeters) * u;
    const angle = p.trailStartAngle + u * T.trailTurns * Math.PI * 2;
    const rise = m.rise(p, Math.cos(angle) * radius, Math.sin(angle) * radius);
    assertClose(rise, p.peak * u, 0.35, `bench height at u=${u}`);
    assert(rise > prev - 1e-9, 'the trail never descends');
    prev = rise;
  }
});

test('the cone face is a wall; the bench is the only walkable ascent', () => {
  const m = def('mountain');
  const p = { ...m.defaults };
  const T = LANDFORM_TUNING.mountain;
  // Cone slope: peak over (baseRadius - rim) ≈ 30/26 → ~49°, steeper than the
  // 24° walk limit.
  const coneSlopeDegrees = (Math.atan(p.peak / (p.baseRadius - T.craterRimRadiusMeters)) * 180) / Math.PI;
  assert(coneSlopeDegrees > T.walkDegrees, 'cone face exceeds the walk limit');
  assertClose(m.walkCos(p), Math.cos((T.walkDegrees * Math.PI) / 180), 1e-12, 'walkCos from tuning');
});

test('the crater holds a wade-depth tarn, not a brim overflow', () => {
  const m = def('mountain');
  const p = { ...m.defaults };
  const T = LANDFORM_TUNING.mountain;
  const lf: LandformInstance = { kind: 'mountain', centerX: 0, centerZ: 0, baseY: 0, params: p };
  const lake = mountainCraterLake(lf);
  assertEqual(lake.level, p.peak - T.craterDepthMeters + T.craterWaterDepthMeters, 'lake level');
  assert(lake.radius > T.craterFloorRadiusMeters && lake.radius < T.craterRimRadiusMeters,
    'water fills part of the bowl');
  assert(T.craterWaterDepthMeters < 1.7, 'wade depth — the figure shows in it');
  assert(m.submergedAt!(p, 0, 0, lake.level - 0.5, 0), 'standing in the tarn is submerged');
  assert(!m.submergedAt!(p, 0, 0, lake.level + 0.5, 0), 'above the surface is dry');
  assert(!m.submergedAt!(p, T.craterRimRadiusMeters + 5, 0, lake.level - 0.5, 0), 'outside the bowl is dry');
});

test('mountain footing: packed-earth trail, sandy/rocky everywhere else', () => {
  const m = def('mountain');
  const p = { ...m.defaults };
  const lf: LandformInstance = { kind: 'mountain', centerX: 0, centerZ: 0, baseY: 0, params: p };
  const head = mountainTrailheadPoint(lf);
  assertEqual(m.surfaceFootingAt!(p, head.x, head.z), 'mud', 'the bench reads as packed earth');
  assertEqual(m.surfaceFootingAt!(p, 0, 0), undefined, 'the crater floor falls back');
  assertEqual(m.surfaceTileKind(p), 'sand', 'off-trail footing is sand');
});

// ── estate ───────────────────────────────────────────────────────────────────

test('estate is a building pad on a dome: flat top at full height, flat ground beyond', () => {
  const e = def('estate');
  const p = { ...e.defaults };
  assertEqual(e.rise(p, 0, 0), p.height, 'center of the pad');
  assertEqual(e.rise(p, p.flatTopRadius, 0), p.height, 'edge of the pad');
  assertClose(e.rise(p, p.baseRadius + landformRoadHalfWidth() + 1, 0), 0, 1e-9, 'beyond the base');
});

test('the estate road is a street: road footing on the bench, lawn beside it', () => {
  const e = def('estate');
  const p = { ...e.defaults };
  // The road starts at the base rim (u=0).
  const startX = Math.cos(p.roadStartAngle) * p.baseRadius;
  const startZ = Math.sin(p.roadStartAngle) * p.baseRadius;
  assertEqual(e.surfaceFootingAt!(p, startX, startZ), 'road', 'on the road you drive a road');
  assertEqual(e.surfaceFootingAt!(p, 0, 0), undefined, 'the pad is not road');
  assertEqual(e.surfaceTileKind(p), 'sand', 'off-road footing is soft ground');
  assertEqual(landformRoadHalfWidth(), LANDFORM_TUNING.estate.roadHalfWidthMeters, 'half-width from tuning');
});

test('the road centerline drapes the dome from base to pad, lifted off the mesh', () => {
  const e = def('estate');
  const p = { ...e.defaults };
  const lf: LandformInstance = { kind: 'estate', centerX: 100, centerZ: -50, baseY: 2, params: p };
  const pts = landformRoadCenterline(lf);
  const T = LANDFORM_TUNING.estate;
  assertEqual(pts.length, (T.roadCenterlineSamples + 1) * 3, 'sample count');
  // First point: on the base rim at grade (+ lift).
  assertClose(Math.hypot(pts[0] - 100, pts[2] + 50), p.baseRadius, 1e-6, 'starts at the base rim');
  assertClose(pts[1], 2 + T.roadRibbonLiftMeters, 1e-6, 'starts at grade');
  // Last point: on the pad edge at full height (+ lift).
  const n = pts.length - 3;
  assertClose(Math.hypot(pts[n] - 100, pts[n + 2] + 50), p.flatTopRadius, 1e-6, 'ends at the pad edge');
  assertClose(pts[n + 1], 2 + p.height + T.roadRibbonLiftMeters, 1e-6, 'ends at pad height');
});

// ── heightfield ──────────────────────────────────────────────────────────────

const FIELD: LandformField = {
  cols: 3,
  rows: 3,
  cell: 2,
  // 3×3 grid, row-major: a single 4m spike in the middle.
  heights: [0, 0, 0, 0, 4, 0, 0, 0, 0],
};

test('a painted heightfield is sampled 1:1 — what you paint is what you walk', () => {
  const h = def('heightfield');
  const p = { ...h.defaults };
  // Grid points are exact: center sample (1,1) sits at local (0,0).
  assertEqual(h.rise(p, 0, 0, FIELD), 4, 'painted spike height at its sample');
  assertEqual(h.rise(p, -2, -2, FIELD), 0, 'corner sample');
  // Between samples, bilinear: halfway from center to a flat neighbour = 2.
  assertEqual(h.rise(p, 1, 0, FIELD), 2, 'bilinear midpoint');
  // Outside the grid is flat; with no field at all, flat.
  assertEqual(h.rise(p, 10, 0, FIELD), 0, 'outside the grid');
  assertEqual(h.rise(p, 0, 0, undefined), 0, 'no field, no rise');
});

test('mesh == collider == field: resolution and footprint come from the grid itself', () => {
  const h = def('heightfield');
  assertEqual(typeof h.resolution === 'function' ? h.resolution(FIELD) : h.resolution, 3,
    'resolution is the grid column count (no resampling)');
  assertEqual(h.footprintRadius(h.defaults, FIELD), 2, 'footprint from grid extent');
  assertEqual(h.footprintRadius(h.defaults, undefined), 0, 'no field, no footprint');
});

test('heightfield walk limit is a per-instance knob with a tuned default', () => {
  const h = def('heightfield');
  assertClose(h.walkCos({ walkDegrees: 10 }), Math.cos((10 * Math.PI) / 180), 1e-12, 'authored limit');
  assertClose(h.walkCos({}), Math.cos((LANDFORM_TUNING.heightfield.defaultWalkDegrees * Math.PI) / 180), 1e-12,
    'tuned default');
});

// ── the shared pure query ────────────────────────────────────────────────────

test('landformSurfaceTop is baseY + rise, and baseY alone for unknown kinds', () => {
  const lf: LandformInstance = { kind: 'estate', centerX: 10, centerZ: 10, baseY: 5, params: { ...def('estate').defaults } };
  assertEqual(landformSurfaceTop(lf, 10, 10), 5 + lf.params.height, 'pad top in world space');
  const ghost: LandformInstance = { kind: 'volcano', centerX: 0, centerZ: 0, baseY: 3, params: {} };
  assertEqual(landformSurfaceTop(ghost, 0, 0), 3, 'unknown kind contributes no rise');
});

finish('kinds/landforms');
