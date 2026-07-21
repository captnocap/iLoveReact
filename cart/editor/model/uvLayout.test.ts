import {
  flattenUvFaceCorners,
  flattenUvIslandRects,
  hitUvFace,
  hitUvIsland,
  isUvDoubleClick,
  moveUvFace,
  moveUvIsland,
  moveUvSelectionVertex,
  moveUvIslandVertex,
  parseUvIslandRects,
  resizeUvIsland,
  resizeUvIslandFromCorner,
  rotateUvSelection,
  shouldPanUvCanvas,
  uniformUvPack,
  uvFaceEdgeSegments,
  uvFaceEdgePath,
  uvIslandBoundarySegments,
  uvIslandBoundaryPath,
  uvIslandVertices,
} from './uvLayout';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) { try { fn(); passed += 1; log(`  ok  ${name}`); } catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); } }
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

test('UV rect parsing and flattening preserve every island and group', () => {
  const parsed = parseUvIslandRects(
    [1, 2, 3, 4, 8, 9, 5, 6],
    [17, 23],
    [0, 1, 2, 4, 2, 1, 6, 1, 8, 9, 13, 9, 8, 15],
  );
  assert(parsed.length === 2 && parsed[1]!.group === 23, 'island metadata was dropped');
  assert(parsed[0]!.triangles?.length === 1 && parsed[1]!.triangles?.length === 1, 'triangle silhouettes were dropped');
  assert(parsed[0]!.triangles?.[0]?.face === 0 && parsed[1]!.triangles?.[0]?.face === 1, 'render-face row identity was dropped');
  assert([...flattenUvIslandRects(parsed)].join(',') === '1,2,3,4,8,9,5,6', 'rect serialization drifted');
  assert([...flattenUvFaceCorners(parsed)!].join(',') === '1,2,4,2,1,6,8,9,13,9,8,15', 'exact face-corner serialization drifted');
});

test('new atlas rows preserve each authored face group inside one connected island', () => {
  const parsed = parseUvIslandRects(
    [0, 0, 10, 10],
    [100],
    [
      0, 700, 1, 1, 9, 1, 9, 9,
      0, 701, 1, 1, 9, 9, 1, 9,
    ],
  );
  assert(parsed[0]!.triangles?.[0]?.group === 700, 'first authored face group was lost');
  assert(parsed[0]!.triangles?.[1]?.group === 701, 'second authored face group was lost');
  const hit = hitUvFace(parsed, 2, 8);
  assert(hit?.island === 0 && hit.target.group === 701, 'exact face hit collapsed back to the connected island');
});

test('real UV handles sit on triangle vertices and collapse shared fan corners', () => {
  const rect = parseUvIslandRects(
    [0, 0, 10, 10],
    [1],
    [0, 0.5, 0.5, 9.5, 0.5, 9.5, 9.5, 0, 0.5, 0.5, 9.5, 9.5, 0.5, 9.5],
  )[0]!;
  const vertices = uvIslandVertices(rect);
  assert(vertices.length === 4, `quad exposed ${vertices.length} handles instead of its four real corners`);
  assert(vertices[0]!.x === 0.5 && vertices[0]!.y === 0.5, 'first handle missed the authored UV vertex');
});

test('moving a UV vertex rewrites coincident face corners without moving the rest', () => {
  const rect = parseUvIslandRects(
    [0, 0, 10, 10],
    [1],
    [0, 0.5, 0.5, 9.5, 0.5, 9.5, 9.5, 0, 0.5, 0.5, 9.5, 9.5, 0.5, 9.5],
  )[0]!;
  const changed = moveUvIslandVertex(rect, 0, 2, 3, 32, 32);
  const corners = flattenUvFaceCorners([changed])!;
  assert(corners[0] === 3 && corners[1] === 4, 'first triangle did not follow its snapped real vertex');
  assert(corners[6] === 3 && corners[7] === 4, 'shared triangle corner tore at the fan seam');
  assert(corners[2] === 9.5 && corners[3] === 0.5 && corners[10] === 0.5 && corners[11] === 9.5, 'unselected UV vertices moved');
});

test('UV vertices snap to whole texels by default and Alt-style free movement bypasses it', () => {
  const rect = parseUvIslandRects([0, 0, 10, 10], [1], [0, 0, 2, 2, 8, 2, 2, 8])[0]!;
  const snapped = flattenUvFaceCorners([moveUvSelectionVertex(rect, undefined, 0, 0.6, 0.6, 32, 32)])!;
  const free = flattenUvFaceCorners([moveUvSelectionVertex(rect, undefined, 0, 0.6, 0.6, 32, 32, true)])!;
  assert(snapped[0] === 3 && snapped[1] === 3, `vertex missed the texel grid: ${snapped[0]},${snapped[1]}`);
  assert(Math.abs(free[0]! - 2.6) < 0.0001 && Math.abs(free[1]! - 2.6) < 0.0001, 'free modifier still snapped the vertex');
});

test('moving one authored fan face leaves the rest of its connected island fixed', () => {
  const rect = parseUvIslandRects(
    [0, 0, 12, 12],
    [100],
    [
      0, 700, 2, 2, 10, 2, 10, 10,
      0, 701, 2, 2, 10, 10, 2, 10,
    ],
  )[0]!;
  const before = flattenUvFaceCorners([rect])!;
  const moved = flattenUvFaceCorners([moveUvFace(rect, { face: 1, group: 701 }, 2, 1, 32, 32)])!;
  assert([...moved.slice(0, 6)].join(',') === [...before.slice(0, 6)].join(','), 'neighbour face followed the detached face');
  assert(moved[6] === before[6]! + 2 && moved[7] === before[7]! + 1, 'target face did not detach by the requested texel delta');
});

test('whole-island movement changes sampling coordinates, not triangle-local geometry', () => {
  const rect = parseUvIslandRects([10, 20, 10, 10], [1], [0, 10.5, 20.5, 19.5, 20.5, 10.5, 29.5])[0]!;
  const moved = moveUvIsland(rect, 20, 15, 64, 64);
  const corners = flattenUvFaceCorners([moved])!;
  assert([...corners].join(',') === '30.5,35.5,39.5,35.5,30.5,44.5', 'moving the shape failed to move its exact texture-sampling coordinates');
});

test('move and resize stay inside the atlas without requiring text selection', () => {
  const rect = { x: 4, y: 5, w: 8, h: 9, group: 0 };
  const moved = moveUvIsland(rect, 100, -100, 32, 24);
  assert(moved.x === 24 && moved.y === 0, 'move did not clamp to the atlas');
  const resized = resizeUvIsland(moved, 100, -100, 32, 24);
  assert(resized.w === 8 && resized.h === 1, 'resize did not clamp to remaining bounds');
});

test('four-corner resize keeps the opposite corner fixed', () => {
  const rect = { x: 10, y: 12, w: 20, h: 16, group: 0 };
  const northwest = resizeUvIslandFromCorner(rect, 'nw', 5, -4, 64, 64);
  assert(northwest.x === 15 && northwest.y === 8 && northwest.w === 15 && northwest.h === 20, 'northwest handle moved the fixed corner');
  const southeast = resizeUvIslandFromCorner(rect, 'se', 80, -80, 64, 64);
  assert(southeast.x === 10 && southeast.y === 12 && southeast.w === 54 && southeast.h === 1, 'southeast handle escaped its bounds');
});

test('hit testing chooses the smallest overlapping island', () => {
  const rects = parseUvIslandRects([0, 0, 20, 20, 5, 5, 3, 3], [1, 2]);
  assert(hitUvIsland(rects, 6, 6) === 1, 'nested island was unreachable');
});

test('triangle hit testing rejects empty space inside a sliver bounding box', () => {
  const rects = parseUvIslandRects([0, 0, 20, 20], [1], [0, 0, 0, 20, 0, 0, 2]);
  assert(hitUvIsland(rects, 10, 1) === 0, 'visible sliver was not selectable');
  assert(hitUvIsland(rects, 10, 15) === -1, 'empty bounding-box space masqueraded as UV geometry');
});

test('island boundary removes an authored quad triangulation diagonal', () => {
  const rects = parseUvIslandRects(
    [0, 0, 10, 10],
    [1],
    [0, 0, 0, 10, 0, 10, 10, 0, 0, 0, 10, 10, 0, 10],
  );
  const path = uvIslandBoundaryPath(rects, 1, 1);
  assert((path.match(/ L /g) ?? []).length === 4, 'shared triangle edge leaked into the authored-face outline');
  assert(uvIslandBoundarySegments(rects, 1, 1).length === 16, 'native boundary segments diverged from the authored-face outline');
});

test('face-edge overlay hides quad diagonals but retains connected fan spokes', () => {
  const quad = parseUvIslandRects(
    [0, 0, 10, 10],
    [1],
    [
      0, 44, 0, 0, 10, 0, 10, 10,
      0, 44, 0, 0, 10, 10, 0, 10,
    ],
  );
  const fan = parseUvIslandRects(
    [0, 0, 10, 10],
    [1],
    [
      0, 44, 0, 0, 10, 0, 10, 10,
      0, 45, 0, 0, 10, 10, 0, 10,
    ],
  );
  assert((uvFaceEdgePath(quad, 1, 1).match(/ L /g) ?? []).length === 4, 'render-only quad diagonal became an authored edge');
  assert((uvFaceEdgePath(fan, 1, 1).match(/ L /g) ?? []).length === 5, 'connected fan spoke disappeared with the island boundary');
  assert(uvFaceEdgeSegments(quad, 1, 1).length === 16, 'native quad segments reintroduced the render diagonal');
  assert(uvFaceEdgeSegments(fan, 1, 1).length === 20, 'native fan segments dropped an authored spoke');
});

test('double-click isolation uses the editor timing and travel thresholds', () => {
  const first = { at: 1000, x: 40, y: 50 };
  assert(isUvDoubleClick(first, { at: 1250, x: 44, y: 52 }), 'nearby second click did not isolate a face');
  assert(!isUvDoubleClick(first, { at: 1500, x: 44, y: 52 }), 'stale click isolated a face');
  assert(!isUvDoubleClick(first, { at: 1250, x: 60, y: 52 }), 'distant click isolated a face');
});

test('rotation magnetically levels a near-axis edge and reports the blue guide', () => {
  const rect = parseUvIslandRects([0, 0, 12, 12], [1], [0, 0, 2, 2, 10, 2, 2, 10])[0]!;
  const levelled = rotateUvSelection(rect, undefined, 0.6, 32, 32);
  assert(Math.abs(levelled.angleDegrees) < 0.0001, `near-horizontal edge stopped at ${levelled.angleDegrees}°`);
  assert(levelled.guide?.axis === 'horizontal', 'level rotation omitted its horizontal guide');
  const free = rotateUvSelection(rect, undefined, 15, 32, 32);
  assert(free.angleDegrees === 15 && free.guide === null, 'ordinary rotation incorrectly magnetized to an axis');
});

test('primary drag selects one face while hand tool or middle drag pans', () => {
  assert(!shouldPanUvCanvas('select', 1), 'primary button was mistaken for middle-button pan');
  assert(shouldPanUvCanvas('select', 2), 'middle button did not pan from the select tool');
  assert(shouldPanUvCanvas('pan', 1), 'hand tool did not pan with the primary button');
});

test('uniform pack gives every island an equal, bounded cell', () => {
  const rects = parseUvIslandRects([0, 0, 1, 7, 0, 0, 20, 1, 0, 0, 3, 9, 0, 0, 8, 2], [0, 1, 2, 3]);
  const packed = uniformUvPack(rects, 64, 64);
  assert(packed.length === 4, 'pack dropped islands');
  assert(packed.every((rect) => rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= 64 && rect.y + rect.h <= 64), 'pack escaped atlas');
  assert(new Set(packed.map((rect) => `${rect.w}x${rect.h}`)).size === 1, 'pack did not normalize cell shapes');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed) throw new Error(`${failed} test(s) failed`);
