// cart/editor/stage/penCurveModes.test.ts — pen curve interpretations (req_4324).
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/stage/penCurveModes.test.ts --bundle \
//     --outfile=/tmp/editor-pen-curves.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit/runtime=$ROOT/runtime \
//     --alias:@reactjit/geometries=$ROOT/runtime/geometries \
//     --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-pen-curves.test.js

import { interpretArcChain, interpretHang, interpretSmooth, PEN_CURVE_MODES, PEN_CURVE_TUNING } from './penCurveModes';
import { capPenPoints, PEN_PATH_TUNING } from '../../../runtime/paint/path';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(s + '\n'));
function test(name: string, fn: () => void) {
  try { fn(); passed++; log(`  ok  ${name}`); }
  catch (e) { failed++; log(`FAIL  ${name}: ${(e as Error).message}`); }
}
function expect(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
function near(a: number, b: number, tol = 1e-6) { return Math.abs(a - b) <= tol; }
function minDist(points: { x: number; y: number }[], q: { x: number; y: number }) {
  return Math.min(...points.map((p) => Math.hypot(p.x - q.x, p.y - q.y)));
}

test('three clicks in ARC mode reproduce arc3pt: every sample on the circle through them', () => {
  // circle of radius 100 centered (100, 100): points at angles 180°, 90°, 0°
  const clicks = [{ x: 0, y: 100 }, { x: 100, y: 0 }, { x: 200, y: 100 }];
  const out = interpretArcChain(clicks);
  expect(out.length > 3, 'the arc is sampled, not just the clicks');
  expect(out.every((p) => near(Math.hypot(p.x - 100, p.y - 100), 100, 1e-6)), 'all samples on the struck circle');
  expect(near(out[0].x, 0) && near(out[out.length - 1].x, 200), 'the arc runs click-to-click');
});

test('five clicks in ARC mode chain two arcs sharing the middle click', () => {
  const clicks = [
    { x: 0, y: 100 }, { x: 50, y: 60 }, { x: 100, y: 100 },
    { x: 150, y: 140 }, { x: 200, y: 100 },
  ];
  const out = interpretArcChain(clicks);
  // joints (every second click) are exact samples; middle clicks sit ON the arc
  // but between samples — within half a sample gap of one
  for (const c of [clicks[0], clicks[2], clicks[4]]) expect(minDist(out, c) < 1e-6, `joint (${c.x},${c.y}) is an exact sample`);
  for (const c of [clicks[1], clicks[3]]) expect(minDist(out, c) < 8, `middle click (${c.x},${c.y}) is on the chain within a sample gap`);
  const dup = out.filter((p, i) => i > 0 && near(p.x, out[i - 1].x) && near(p.y, out[i - 1].y));
  expect(dup.length === 0, 'shared joints appear once, never doubled');
});

test('a leftover fourth click continues straight after the struck arc', () => {
  const clicks = [{ x: 0, y: 100 }, { x: 100, y: 0 }, { x: 200, y: 100 }, { x: 260, y: 130 }];
  const out = interpretArcChain(clicks);
  expect(near(out[out.length - 1].x, 260) && near(out[out.length - 1].y, 130), 'the chain ends at the leftover click');
});

test('SMOOTH passes through every click, open and closed', () => {
  const clicks = [{ x: 20, y: 200 }, { x: 120, y: 40 }, { x: 260, y: 180 }, { x: 380, y: 60 }];
  const open = interpretSmooth(clicks, false);
  for (const c of clicks) expect(minDist(open, c) < 1e-9, `open spline hits (${c.x},${c.y})`);
  const ring = interpretSmooth(clicks, true);
  for (const c of clicks) expect(minDist(ring, c) < 1e-9, `closed spline hits (${c.x},${c.y})`);
});

test('HANG spans first to last click and sags below the chord (screen y grows down)', () => {
  const out = interpretHang([{ x: 50, y: 100 }, { x: 350, y: 100 }]);
  expect(near(out[0].x, 50, 1e-3) && near(out[out.length - 1].x, 350, 1e-3), 'endpoints are the clicks');
  const low = Math.max(...out.map((p) => p.y));
  const expected = 100 + 300 * PEN_CURVE_TUNING.hangDefaultSagRatio;
  expect(near(low, expected, 2), `default sag drops span/4 below the chord (got ${low.toFixed(1)})`);
});

test('a middle click above the chord flips HANG into an arch', () => {
  const out = interpretHang([{ x: 50, y: 200 }, { x: 200, y: 120 }, { x: 350, y: 200 }]);
  const high = Math.min(...out.map((p) => p.y));
  expect(high < 140, `the chain rises toward the raised click (got ${high.toFixed(1)})`);
  expect(out.every((p) => p.y <= 200 + 1e-6), 'an arch never dips below its springings');
});

test('every registered mode output survives the pen 64-point budget', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ x: i * 30, y: 100 + Math.sin(i) * 60 }));
  for (const mode of PEN_CURVE_MODES) {
    const capped = capPenPoints(mode.interpret(many, false), false);
    expect(capped.length <= PEN_PATH_TUNING.maxPolygonPoints, `${mode.id} caps at ${PEN_PATH_TUNING.maxPolygonPoints}`);
    expect(capped.length >= 2, `${mode.id} still yields a path`);
    expect(capped.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)), `${mode.id} finite under the cap`);
  }
});

test('degenerate clicks never throw: single point, doubled points, vertical chord', () => {
  for (const mode of PEN_CURVE_MODES) {
    expect(mode.interpret([{ x: 5, y: 5 }], false).length <= 1, `${mode.id} tolerates one click`);
    const doubled = mode.interpret([{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 9, y: 9 }], false);
    expect(doubled.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)), `${mode.id} tolerates doubled clicks`);
  }
  const vertical = interpretHang([{ x: 100, y: 50 }, { x: 100, y: 250 }]);
  expect(vertical.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)), 'vertical HANG degrades to the chord');
});

log('');
log(`pen curves: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
