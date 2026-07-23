import { flattenClosedPenPath, flattenOpenPenPath, normalizedPenPath, normalizedPenPolygon, penPathD, type PenAnchor } from './path';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) { try { fn(); passed += 1; log(`  ok  ${name}`); } catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); } }
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

test('sharp anchors flatten to one bounded closed polygon', () => {
  const anchors: PenAnchor[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const points = flattenClosedPenPath(anchors);
  assert(points.length >= 4 && points.length <= 64, `unexpected point count ${points.length}`);
  assert(points[0]!.x === 0 && points[0]!.y === 0, 'first anchor drifted');
  assert(!points.some((point, index) => index > 0 && point.x === 0 && point.y === 0), 'closing endpoint was duplicated');
});

test('Bezier handles affect both the preview and flattened commit', () => {
  const anchors: PenAnchor[] = [
    { x: 0, y: 0, out: { x: 40, y: -50 } },
    { x: 100, y: 0, in: { x: 60, y: 50 } },
    { x: 50, y: 100 },
  ];
  assert(penPathD(anchors, true).includes(' C '), 'preview lost cubic controls');
  const points = flattenClosedPenPath(anchors);
  assert(points.some((point) => Math.abs(point.y) > 0.5 && point.x < 100), 'commit flattened as straight lines');
});

test('normalization clamps every committed coordinate and honors the host point cap', () => {
  const anchors: PenAnchor[] = Array.from({ length: 32 }, (_, index) => {
    const angle = (index / 32) * Math.PI * 2;
    return { x: 100 + Math.cos(angle) * 120, y: 50 + Math.sin(angle) * 80 };
  });
  const polygon = normalizedPenPolygon(anchors, 200, 100, 20);
  assert(polygon.length === 40, `expected 20 points, got ${polygon.length / 2}`);
  assert([...polygon].every((value) => value >= 0 && value <= 1), 'normalization escaped the surface');
});

test('open pen paths keep their real endpoint and never close', () => {
  const anchors: PenAnchor[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
  const points = flattenOpenPenPath(anchors);
  assert(points.length >= 3 && points.length <= 64, `unexpected point count ${points.length}`);
  assert(points[0]!.x === 0 && points[0]!.y === 0, 'first anchor drifted');
  const last = points[points.length - 1]!;
  assert(last.x === 100 && last.y === 100, 'open path lost its endpoint');
  // Two anchors — the minimum wire — still flatten; one anchor cannot.
  assert(flattenOpenPenPath([{ x: 0, y: 0 }, { x: 10, y: 0 }]).length >= 2, 'two-anchor path refused');
  assert(flattenOpenPenPath([{ x: 0, y: 0 }]).length === 0, 'one anchor should not flatten');
});

test('normalizedPenPath routes closed through the polygon and open through the polyline', () => {
  const anchors: PenAnchor[] = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }];
  const closed = normalizedPenPath(anchors, true, 200, 100);
  const open = normalizedPenPath(anchors, false, 200, 100);
  assert(closed.length >= 6, 'closed path lost points');
  assert(open.length >= 6, 'open path lost points');
  assert(open[open.length - 2] === 1 && open[open.length - 1] === 1, 'open endpoint not normalized in place');
  assert([...open].every((value) => value >= 0 && value <= 1), 'normalization escaped the surface');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed) throw new Error(`${failed} test(s) failed`);
