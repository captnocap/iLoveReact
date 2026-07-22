import {
  chainUvIslands,
  flattenUvFaceCorners,
  flattenUvIslandRects,
  flipUvSelection,
  hitUvFace,
  hitUvIsland,
  isUvDoubleClick,
  moveUvFace,
  moveUvIsland,
  moveUvIslands,
  moveUvSelectionVertex,
  moveUvIslandVertex,
  panUvCanvasView,
  parseUvIslandRects,
  resizeUvIsland,
  resizeUvIslandFromCorner,
  rotateUvSelection,
  matchUvIslandSize,
  shouldActivateUvDrag,
  shouldPanUvCanvas,
  uniformUvPack,
  uvContextMenuPosition,
  uvSelectionModeAfterDoubleClick,
  uvFaceEdgeSegments,
  uvFaceEdgePath,
  uvIslandBoundarySegments,
  uvIslandBoundaryPath,
  uvIslandVertices,
  uvIslandSetBounds,
  uvSelectionBounds,
  uvTranslationSnapStep,
  zoomUvCanvasViewAt,
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

test('dense fan handles and bounds stay exact at production face counts', () => {
  const faceCount = 600;
  const rim = Array.from({ length: faceCount }, (_unused, index) => {
    const angle = index / faceCount * Math.PI * 2;
    return { x: 0.5 + Math.cos(angle) * 0.4, y: 0.5 + Math.sin(angle) * 0.4 };
  });
  const rect = {
    x: 10,
    y: 20,
    w: 100,
    h: 80,
    group: 1,
    triangles: rim.map((point, index) => {
      const next = rim[(index + 1) % rim.length]!;
      return { face: index, group: index, points: [0.5, 0.5, point.x, point.y, next.x, next.y] as const };
    }),
  };
  const vertices = uvIslandVertices(rect);
  assert(vertices.length === faceCount + 1, `dense fan exposed ${vertices.length} handles instead of ${faceCount + 1}`);
  const bounds = uvSelectionBounds(rect)!;
  assert(Math.abs(bounds.x - 20) < 0.0001 && Math.abs(bounds.y - 28) < 0.0001, 'dense fan minimum bounds drifted');
  assert(Math.abs(bounds.w - 80) < 0.0001 && Math.abs(bounds.h - 64) < 0.0001, 'dense fan size bounds drifted');
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

test('zoomed-out translation uses a perceptible grid and Alt bypasses it everywhere', () => {
  assert(uvTranslationSnapStep(4) === 1, 'visible texels did not retain one-pixel precision');
  assert(uvTranslationSnapStep(1) === 4, 'one-to-one zoom did not strengthen the translation latch');
  assert(uvTranslationSnapStep(0.25) === 16, 'zoomed-out movement fell back to sub-pixel screen steps');
  assert(uvTranslationSnapStep(4, 8) === 8, 'explicit grid precision was weakened while zoomed in');
  assert(uvTranslationSnapStep(0.25, 8) === 16, 'explicit grid precision did not remain a minimum while zoomed out');

  const rect = parseUvIslandRects([3, 3, 8, 8], [1], [0, 3, 3, 11, 3, 3, 11])[0]!;
  const snappedIsland = moveUvIsland(rect, 2.1, 2.1, 32, 32, 4);
  const freeIsland = moveUvIsland(rect, 2.1, 2.1, 32, 32, 4, true);
  assert(snappedIsland.x === 4 && snappedIsland.y === 4, `island missed its absolute snap anchor: ${snappedIsland.x},${snappedIsland.y}`);
  assert(Math.abs(freeIsland.x - 5.1) < 0.0001 && Math.abs(freeIsland.y - 5.1) < 0.0001, 'Alt-style island movement still snapped');

  const snappedVertex = flattenUvFaceCorners([moveUvSelectionVertex(rect, undefined, 0, 2.1, 2.1, 32, 32, false, 4)])!;
  assert(snappedVertex[0] === 4 && snappedVertex[1] === 4, 'vertex did not share the adaptive translation grid');
  const snappedFace = flattenUvFaceCorners([moveUvFace(rect, { face: 0, group: 1 }, 2.1, 2.1, 32, 32, 4)])!;
  const freeFace = flattenUvFaceCorners([moveUvFace(rect, { face: 0, group: 1 }, 2.1, 2.1, 32, 32, 4, true)])!;
  assert(snappedFace[0] === 4 && snappedFace[1] === 4, 'isolated face did not share the adaptive translation grid');
  assert(Math.abs(freeFace[0]! - 5.1) < 0.0001 && Math.abs(freeFace[1]! - 5.1) < 0.0001, 'Alt-style face movement still snapped');
  const aligned = parseUvIslandRects([4, 4, 8, 8], [1], [0, 4, 4, 12, 4, 4, 12])[0]!;
  assert(moveUvIsland(aligned, 0.4, 0.4, 32, 32, 4) === aligned, 'motion inside one snap cell still churned the preview');
  assert(moveUvFace(aligned, { face: 0, group: 1 }, 0.4, 0.4, 32, 32, 4) === aligned, 'isolated face churned inside one snap cell');
  assert(moveUvSelectionVertex(aligned, undefined, 0, 0.4, 0.4, 32, 32, false, 4) === aligned, 'vertex churned inside one snap cell');
});

test('multi-island movement is rigid, grid-snapped, and clamped once as a group', () => {
  const rects = parseUvIslandRects([1, 2, 4, 5, 8, 7, 3, 2, 20, 20, 2, 2], [1, 2, 3]);
  const bounds = uvIslandSetBounds(rects, [0, 1]);
  assert(bounds?.x === 1 && bounds.y === 2 && bounds.w === 10 && bounds.h === 7, 'multi-selection frame missed a member');
  const moved = moveUvIslands(rects, [0, 1], 100, 100, 16, 16, 4);
  assert(moved[0]!.x === 6 && moved[0]!.y === 9, 'group did not clamp against its aggregate bounds');
  assert(moved[1]!.x === 13 && moved[1]!.y === 14, 'second island drifted inside the group');
  assert(moved[1]!.x - moved[0]!.x === 7 && moved[1]!.y - moved[0]!.y === 5, 'group offsets changed at the atlas edge');
  assert(moved[2] === rects[2], 'group movement rewrote an unselected island');
});

test('selected islands match the active size without changing unselected UVs', () => {
  const rects = parseUvIslandRects(
    [0, 0, 8, 6, 16, 4, 4, 3, 30, 30, 2, 2],
    [1, 2, 3],
    [
      0, 0, 0, 8, 0, 0, 6,
      1, 16, 4, 20, 4, 16, 7,
      2, 30, 30, 32, 30, 30, 32,
    ],
  );
  const matched = matchUvIslandSize(rects, [0, 1], 0, 'both', 64, 64);
  const activeBounds = uvSelectionBounds(matched[0]!)!;
  const matchedBounds = uvSelectionBounds(matched[1]!)!;
  assert(Math.abs(activeBounds.w - matchedBounds.w) < 0.0001, 'matched island width missed the active island');
  assert(Math.abs(activeBounds.h - matchedBounds.h) < 0.0001, 'matched island height missed the active island');
  assert(matched[2] === rects[2], 'size matching rewrote an unselected island');
});

test('horizontal and vertical chains follow the snap grid and report atlas overflow', () => {
  const rects = parseUvIslandRects([11, 9, 3, 4, 1, 1, 5, 2, 20, 20, 2, 2], [1, 2, 3]);
  const horizontal = chainUvIslands(rects, [0, 1], 'horizontal', 32, 32, 4, 4);
  assert(horizontal.fits, 'valid horizontal chain was refused');
  assert(horizontal.rects[1]!.x === 0 && horizontal.rects[0]!.x === 12, 'horizontal chain ignored spatial order or grid gap');
  assert(horizontal.rects[0]!.y === horizontal.rects[1]!.y && horizontal.rects[0]!.y % 4 === 0, 'horizontal chain did not share a snapped top edge');
  const vertical = chainUvIslands(rects, [0, 1], 'vertical', 32, 32, 4, 4);
  assert(vertical.fits && vertical.rects[1]!.y === 0 && vertical.rects[0]!.y === 8, 'vertical chain missed its snapped sequence');
  const overflow = chainUvIslands(parseUvIslandRects([0, 0, 20, 2, 0, 4, 20, 2], [1, 2]), [0, 1], 'horizontal', 32, 32, 4, 4);
  assert(!overflow.fits, 'chain larger than the atlas did not report overflow');
});

test('selection clicks cannot nudge UVs before the drag latch opens', () => {
  assert(!shouldActivateUvDrag(4, 0), 'activation radius itself started a drag');
  assert(!shouldActivateUvDrag(2, 2), 'pointer jitter started a drag');
  assert(shouldActivateUvDrag(4.01, 0), 'intentional movement did not open the drag latch');
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

test('UV flips reverse handedness for an island or one isolated authored face', () => {
  const rect = parseUvIslandRects(
    [0, 0, 12, 12],
    [100],
    [
      0, 700, 2, 2, 10, 2, 8, 9,
      0, 701, 1, 10, 4, 6, 7, 10,
    ],
  )[0]!;
  const before = flattenUvFaceCorners([rect])!;
  const faceTarget = { face: 0, group: 700 };
  const faceFlipped = flattenUvFaceCorners([flipUvSelection(rect, faceTarget, 'u', 32, 32)])!;
  assert([...faceFlipped.slice(6)].join(',') === [...before.slice(6)].join(','), 'face flip changed its neighbour');
  assert([...faceFlipped.slice(0, 6)].join(',') === '10,2,2,2,4,9', 'horizontal face flip did not reverse U around its own center');

  const islandFlipped = flipUvSelection(rect, undefined, 'v', 32, 32);
  const islandCorners = flattenUvFaceCorners([islandFlipped])!;
  assert([...islandCorners].join(',') === '2,10,10,10,8,3,1,2,4,6,7,2', 'vertical island flip did not reverse V around the island center');
  const restored = flattenUvFaceCorners([flipUvSelection(islandFlipped, undefined, 'v', 32, 32)])!;
  assert([...restored].join(',') === [...before].join(','), 'double UV flip failed to restore the exact mapping');
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

test('wheel zoom keeps the atlas point beneath the cursor fixed', () => {
  const view = { x: 31, y: -12, scale: 2 };
  const cursor = { x: 211, y: 108 };
  const atlasBefore = { x: (cursor.x - view.x) / view.scale, y: (cursor.y - view.y) / view.scale };
  const zoomed = zoomUvCanvasViewAt(view, cursor, 1.25);
  const atlasAfter = { x: (cursor.x - zoomed.x) / zoomed.scale, y: (cursor.y - zoomed.y) / zoomed.scale };
  assert(Math.abs(atlasAfter.x - atlasBefore.x) < 0.0001, 'wheel zoom slid the atlas horizontally beneath the cursor');
  assert(Math.abs(atlasAfter.y - atlasBefore.y) < 0.0001, 'wheel zoom slid the atlas vertically beneath the cursor');
});

test('middle pan derives from its seed and double-click toggles face isolation', () => {
  const panned = panUvCanvasView({ x: 10, y: 20, scale: 3 }, { x: 80, y: 70 }, { x: 101, y: 64 });
  assert(panned.x === 31 && panned.y === 14 && panned.scale === 3, 'middle pan drifted or changed zoom');
  assert(uvSelectionModeAfterDoubleClick('island', true) === 'face', 'double-click did not enter face isolation');
  assert(uvSelectionModeAfterDoubleClick('face', true) === 'island', 'double-click did not leave face isolation');
  assert(uvSelectionModeAfterDoubleClick('face', false) === 'face', 'blank double-click changed selection scope');
});

test('nested UV context menus convert window coordinates into the inspector', () => {
  const placed = uvContextMenuPosition(
    { x: 1800, y: 600 },
    { x: 1500, y: 80, width: 430, height: 900 },
    { width: 220, height: 390 },
    4,
  );
  assert(placed.x === 80, `right-panel menu landed at the wrong local X (${placed.x})`);
  assert(placed.y === 506, `bottom-edge menu was not kept inside the panel (${placed.y})`);
  const topEdge = uvContextMenuPosition(
    { x: 1502, y: 81 },
    { x: 1500, y: 80, width: 430, height: 900 },
    { width: 220, height: 390 },
    4,
  );
  assert(topEdge.x === 4 && topEdge.y === 4, 'menu escaped the panel top/left edge');
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
