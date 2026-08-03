import {
  chainUvIslands,
  countUvTextureFootprints,
  flattenUvFaceCorners,
  flattenUvIslandRects,
  flipUvSelection,
  hitUvGridGuide,
  hitUvGuide,
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
  pasteUvTransform,
  planProgressiveRepeatedUvStacks,
  planRepeatedUvStacks,
  planTwoSheetUvLayout,
  resizeUvIsland,
  resizeUvIslandFromCorner,
  rotateUvSelection,
  scaleUvSelection,
  matchUvIslandSize,
  shouldActivateUvDrag,
  shouldPanUvCanvas,
  stackUvIslands,
  stitchUvIslands,
  snapUvBoundsToGuides,
  snapUvTranslationToGridAndGuides,
  toggleUvGridGuide,
  uniformUvPack,
  uvAspectClass,
  uvContextMenuPosition,
  uvSelectionModeAfterDoubleClick,
  uvScaleDragPoint,
  uvFaceEdgeSegments,
  uvFaceEdgePath,
  uvFaceCornerIdentityMarkers,
  uvCornerIdentityColor,
  uvIslandBoundarySegments,
  uvIslandBoundaryPath,
  uvIslandsIntersectingMarquee,
  uvIslandVertices,
  uvIslandSetBounds,
  uvRepeatSemanticFamily,
  uvSelectionBounds,
  uvTranslationSnapStep,
  uvWorkspaceGridSegments,
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

test('selected UV corners retain the welded 3D vertex identities and colors', () => {
  const parsed = parseUvIslandRects(
    [0, 0, 10, 10],
    [100],
    [
      0, 700, 1, 1, 9, 1, 9, 9,
      0, 700, 1, 1, 9, 9, 1, 9,
    ],
    [41, 42, 43, 41, 43, 44],
  );
  const markers = uvFaceCornerIdentityMarkers(parsed, [0, 1]);
  assert(markers.length === 4, `quad exposed ${markers.length} identity markers instead of four welded corners`);
  assert(markers.map((marker) => marker.vertex).join(',') === '41,42,43,44', 'UV marker order drifted from the mesh triangle/corner order');
  assert(new Set(markers.map((marker) => uvCornerIdentityColor(marker.vertex))).size === 4, 'one face assigned duplicate corner colors');
  assert(uvCornerIdentityColor(41) === uvCornerIdentityColor(41), 'one welded vertex did not retain a stable color');
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

test('visible UV grid lines toggle as magnetic alignment guides', () => {
  const vertical = hitUvGridGuide({ x: 8.3, y: 19 }, 32, 32, 4, 0.5);
  const horizontal = hitUvGridGuide({ x: 14, y: 11.8 }, 32, 32, 4, 0.5);
  assert(vertical?.axis === 'vertical' && vertical.coordinate === 8, 'vertical grid line could not become a guide');
  assert(horizontal?.axis === 'horizontal' && horizontal.coordinate === 12, 'horizontal grid line could not become a guide');
  assert(hitUvGridGuide({ x: 10, y: 10 }, 32, 32, 4, 0.5) === null, 'blank grid cell selected a distant line');
  assert(hitUvGridGuide({ x: 0.1, y: 10 }, 32, 32, 4, 0.5)?.coordinate === 0, 'signed workspace origin was not selectable as a guide');
  assert(hitUvGridGuide({ x: -8.2, y: -15 }, 32, 32, 4, 0.5)?.coordinate === -8, 'negative workspace grid line was not selectable');
  assert(hitUvGuide({ x: 6.2, y: 20 }, 32, 32, [{ axis: 'vertical', coordinate: 6 }], 0.5)?.coordinate === 6, 'selected guide became unclickable after its grid line disappeared');

  const selected = toggleUvGridGuide(toggleUvGridGuide([], vertical!), horizontal!);
  assert(selected.length === 2 && selected[0]?.axis === 'vertical', 'guide toggles lost deterministic axis order');
  const removed = toggleUvGridGuide(selected, vertical!);
  assert(removed.length === 1 && removed[0]?.axis === 'horizontal', 'clicking a selected guide did not remove it');

  const snap = snapUvBoundsToGuides(
    { x: 9, y: 17, w: 6, h: 5, cx: 12, cy: 19.5 },
    [{ axis: 'vertical', coordinate: 16 }, { axis: 'horizontal', coordinate: 24 }],
    2.1,
  );
  assert(snap.dx === 1 && snap.dy === 2, `selection missed guide edges: ${snap.dx},${snap.dy}`);
  assert(snap.guides.length === 2, 'two-axis guide latch reported only one axis');

  const translated = snapUvTranslationToGridAndGuides(
    { x: 9, y: 4, w: 6, h: 4, cx: 12, cy: 6 },
    2.2,
    0,
    4,
    [{ axis: 'vertical', coordinate: 20 }],
    2.1,
  );
  assert(translated.dx === 5 && translated.guides[0]?.coordinate === 20, 'grid-first movement did not latch the far edge to its guide');
  const free = snapUvTranslationToGridAndGuides(
    { x: 9, y: 4, w: 6, h: 4, cx: 12, cy: 6 },
    2.2,
    0.3,
    4,
    [{ axis: 'vertical', coordinate: 20 }],
    10,
    true,
  );
  assert(free.dx === 2.2 && free.dy === 0.3 && free.guides.length === 0, 'Alt-style free movement still latched a guide');
});

test('multi-island movement is rigid, grid-snapped, and unbounded as a group', () => {
  const rects = parseUvIslandRects([1, 2, 4, 5, 8, 7, 3, 2, 20, 20, 2, 2], [1, 2, 3]);
  const bounds = uvIslandSetBounds(rects, [0, 1]);
  assert(bounds?.x === 1 && bounds.y === 2 && bounds.w === 10 && bounds.h === 7, 'multi-selection frame missed a member');
  const moved = moveUvIslands(rects, [0, 1], 100, 100, 16, 16, 4);
  assert(moved[0]!.x === 100 && moved[0]!.y === 104, 'group did not cross the former atlas edge');
  assert(moved[1]!.x === 107 && moved[1]!.y === 109, 'second island drifted inside the group');
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

test('stacking selected islands makes them sample one active UV footprint', () => {
  const rects = parseUvIslandRects(
    [0, 0, 10, 10, 20, 10, 12, 10, 40, 40, 4, 4],
    [10, 11, 12],
    [
      0, 10, 0, 0, 10, 0, 8, 10,
      0, 10, 0, 0, 8, 10, 2, 7,
      1, 11, 20, 10, 32, 12, 29, 20,
      1, 11, 20, 10, 29, 20, 22, 16,
      2, 12, 40, 40, 44, 40, 40, 44,
    ],
    [
      1, 2, 3, 1, 3, 4,
      10, 11, 12, 10, 12, 13,
      20, 21, 22,
    ],
  );
  const result = stackUvIslands(rects, [0, 1], 1);
  const corners = flattenUvFaceCorners(result.rects)!;
  assert([...corners.slice(0, 6)].join(',') === [...corners.slice(12, 18)].join(','), 'first source triangle did not exactly copy the active triangle');
  assert([...corners.slice(6, 12)].join(',') === [...corners.slice(18, 24)].join(','), 'second source triangle did not exactly copy the active triangle');
  assert(result.compatible === 1 && result.skipped === 0, 'compatible exact stack was reported as skipped');
  assert(result.rects[0]!.triangles?.[0]?.face === 0 && result.rects[0]!.triangles?.[1]?.face === 1, 'exact stack replaced source face rows');
  assert(result.rects[0]!.triangles?.[0]?.vertices?.join(',') === '1,2,3', 'exact stack replaced source welded vertex identities');
  assert(result.rects[1] === rects[1], 'stacking rewrote the active UV island');
  assert(result.rects[2] === rects[2], 'stacking rewrote an unselected UV island');
  const repeated = stackUvIslands(result.rects, [0, 1], 1);
  assert(repeated.rects[0] === result.rects[0], 'stacking an already-overlapped island churned its geometry');
});

test('exact stacking refuses incompatible triangle counts instead of approximating bounds', () => {
  const rects = parseUvIslandRects(
    [0, 0, 4, 4, 20, 20, 8, 8],
    [10, 11],
    [
      0, 10, 0, 0, 4, 0, 0, 4,
      1, 11, 20, 20, 28, 20, 28, 28,
      1, 11, 20, 20, 28, 28, 20, 28,
    ],
  );
  const result = stackUvIslands(rects, [0, 1], 1);
  assert(result.compatible === 0 && result.skipped === 1, 'incompatible stack did not report its skipped island');
  assert(result.rects[0] === rects[0], 'incompatible source island was approximately rescaled');
});

test('repeat prestack matches UV coverage across quarter turns without trusting equal bounds', () => {
  const rects = parseUvIslandRects(
    [0, 0, 10, 20, 30, 0, 20, 10, 60, 0, 10, 20, 80, 0, 10, 20],
    [10, 20, 30, 40],
    [
      0, 10, 0, 0, 10, 0, 10, 20,
      0, 10, 0, 0, 10, 20, 0, 20,
      1, 20, 30, 10, 30, 0, 50, 0,
      1, 20, 30, 10, 50, 0, 50, 10,
      2, 30, 65, 0, 70, 10, 65, 20,
      2, 30, 65, 0, 65, 20, 60, 10,
      3, 40, 90, 0, 80, 0, 80, 20,
      3, 40, 90, 0, 80, 20, 90, 20,
    ],
    [
      0, 1, 2, 0, 2, 3,
      10, 11, 12, 10, 12, 13,
      20, 21, 22, 20, 22, 23,
      30, 31, 32, 30, 32, 33,
    ],
  );
  const plan = planRepeatedUvStacks(rects, 'exact', 128, 128);
  assert(plan.groups.length === 1, `repeat scan invented ${plan.groups.length} families`);
  assert(plan.groups[0]!.islands.join(',') === '0,1,3', 'quarter-turned and mirrored copies did not join their exact family');
  assert(plan.stackedIslands === 2 && plan.changedIslands === 2, 'repeat scan reported the wrong mutation size');
  assert(plan.sourceFootprints === 4, 'repeat scan lost the current unstacked footprint count');
  assert(plan.uniqueFootprints === 2, 'repeat scan did not collapse one logical texture footprint');
  assert(plan.rects[2] === rects[2], 'equal-bounds diamond was mistaken for the rectangular topology');
  const corners = flattenUvFaceCorners(plan.rects)!;
  const pointSet = (start: number, count: number) => {
    const points: string[] = [];
    for (let at = start; at < start + count; at += 2) points.push(`${corners[at]},${corners[at + 1]}`);
    return points.sort().join('|');
  };
  const boundarySet = (index: number) => {
    const segments = uvIslandBoundarySegments([plan.rects[index]!], 1, 1);
    const edges: string[] = [];
    for (let at = 0; at + 3 < segments.length; at += 4) {
      const a = `${segments[at]},${segments[at + 1]}`;
      const b = `${segments[at + 2]},${segments[at + 3]}`;
      edges.push(a < b ? `${a}/${b}` : `${b}/${a}`);
    }
    return edges.sort().join('|');
  };
  assert(pointSet(0, 12) === pointSet(12, 12), 'stacked quarter-turn missed the representative corners');
  assert(boundarySet(0) === boundarySet(3), 'stacked mirror missed the representative coverage boundary');
  assert(plan.rects[1]!.triangles?.[0]?.face === 2, 'prestack replaced source render-face identity');
  assert(plan.rects[1]!.triangles?.[0]?.vertices?.join(',') === '10,11,12', 'prestack replaced welded source identity');

  const alreadyStacked = planRepeatedUvStacks(plan.rects, 'exact', 128, 128);
  assert(alreadyStacked.sourceIslands === 4, 'idempotent repeat scan confused logical islands with footprints');
  assert(alreadyStacked.sourceFootprints === 2 && alreadyStacked.uniqueFootprints === 2, 'idempotent repeat scan advertised an already-landed footprint reduction');
  assert(alreadyStacked.stackedIslands === 2, 'idempotent repeat scan lost its congruent family membership');
  assert(alreadyStacked.changedIslands === 0, 'idempotent repeat scan advertised already-overlapped islands as pending moves');
});

test('normalized repeat prestack adopts the largest congruent family footprint', () => {
  const rects = parseUvIslandRects(
    [0, 0, 10, 20, 30, 0, 20, 40, 60, 0, 20, 30],
    [10, 20, 30],
    [
      0, 10, 0, 0, 10, 0, 0, 20,
      1, 20, 30, 0, 50, 0, 30, 40,
      2, 30, 60, 0, 80, 0, 60, 30,
    ],
    [
      0, 1, 2,
      10, 11, 12,
      20, 21, 22,
    ],
  );
  const exact = planRepeatedUvStacks(rects, 'exact', 128, 128);
  assert(exact.groups.length === 0, 'exact mode silently normalized a differently scaled triangle');
  const normalized = planRepeatedUvStacks(rects, 'normalize', 128, 128);
  assert(normalized.groups.length === 1, 'normalized mode missed a congruent scaled triangle');
  assert(normalized.groups[0]!.representative === 1, 'normalize mode did not retain the largest family footprint');
  assert(normalized.groups[0]!.islands.join(',') === '0,1', 'distorted same-count triangle joined the family');
  assert(normalized.normalizedIslands === 1 && normalized.changedIslands === 1, 'normalize preview lost its rescale count');
  const corners = flattenUvFaceCorners(normalized.rects)!;
  assert(
    [...corners.slice(0, 6)].join(',') === [...corners.slice(6, 12)].join(','),
    'normalized family did not sample the representative triangle exactly',
  );
  const progressive = planProgressiveRepeatedUvStacks(rects, 128, 128);
  assert(progressive.uniqueFootprints <= exact.uniqueFootprints,
    'Normalize mode discarded exact wins instead of adding scale-normalized families');
});

test('normalized repeat prestack protects congruent UV surfaces above its area threshold', () => {
  const rects = parseUvIslandRects(
    [0, 0, 10, 20, 30, 0, 20, 40, 60, 0, 5, 10],
    [10, 20, 30],
    [
      0, 10, 0, 0, 10, 0, 0, 20,
      1, 20, 30, 0, 50, 0, 30, 40,
      2, 30, 60, 0, 65, 0, 60, 10,
    ],
    [
      0, 1, 2,
      10, 11, 12,
      20, 21, 22,
    ],
  );
  const gated = planRepeatedUvStacks(rects, 'normalize', 128, 128, {
    normalizeMaxAreaTexels: 120,
  });
  assert(gated.groups.length === 1, 'area gate removed the eligible small repeated family');
  assert(gated.groups[0]!.representative === 0, 'area gate did not retain the largest eligible footprint');
  assert(gated.groups[0]!.islands.join(',') === '0,2', 'large UV surface joined a below-threshold family');
  assert(gated.rects[1] === rects[1], 'large protected UV surface was changed');
  assert(gated.normalizedIslands === 1, 'area-gated normalize lost its scale-change count');
  assert(gated.normalizeMaxAreaTexels === 120, 'area-gated plan did not retain its reviewed threshold');
  assert(gated.normalizationProtectedIslands === 1, 'area-gated plan did not report the protected surface');

  const sliverOnly = planRepeatedUvStacks(rects, 'normalize', 128, 128, {
    normalizeMaxAreaTexels: 50,
  });
  assert(sliverOnly.groups.length === 0, 'one below-threshold sliver invented a stack family');
  assert(sliverOnly.stackedIslands === 0, 'one below-threshold sliver changed the UV layout');
  assert(sliverOnly.normalizationProtectedIslands === 2, 'stricter area gate did not protect both larger matches');
});

test('two-sheet planner preserves proportional scale, floors unreadable support parts, and stacks repeats without mutation', () => {
  const rects = parseUvIslandRects(
    [
      0, 0, 40, 40,
      60, 0, 10, 10,
      80, 0, 10, 10,
      100, 0, 20, 10,
      130, 0, 32, 2,
    ],
    [10, 20, 30, 40, 50],
    [
      0, 10, 0, 0, 40, 0, 0, 40,
      1, 20, 60, 0, 70, 0, 60, 10,
      2, 30, 80, 0, 90, 0, 80, 10,
      3, 40, 100, 0, 120, 0, 100, 10,
      4, 50, 130, 0, 162, 0, 130, 2,
    ],
    [
      0, 1, 2,
      10, 11, 12,
      20, 21, 22,
      30, 31, 32,
      40, 41, 42,
    ],
  );
  const sourceCorners = [...flattenUvFaceCorners(rects)!];
  const plan = planTwoSheetUvLayout(rects, 256, 256, {
    heroIslands: [0],
    uniformIslands: [1, 2, 3, 4],
    intents: rects.map((_rect, island) => ({
      material: 1,
      semanticNames: [island === 0 ? 'body.hero.panel' : island < 3 ? 'fastener.cap' : 'trim.material'],
    })),
    minimumReadableAreaTexels: 100,
    maximumReadabilityBoost: 2,
  });
  assert(plan.fits, plan.reason ?? 'two-sheet plan did not fit');
  assert(plan.densityLaw === 'proportional-with-floor', 'planner hid the proportional readability-floor rule');
  assert(plan.heroFootprints === 1 && plan.uniformFootprints === 3, 'hero/uniform classification ignored explicit intent');
  assert(plan.prestackedFootprints === 4 && plan.uniqueFootprints === 4, 'identical uniform twins did not share one literal footprint');
  assert(plan.heroScale === 1, 'hero art was rescaled despite fitting at natural size');
  assert(plan.minimumReadableAreaRequested === 100 && plan.minimumReadableAreaAchieved === 100,
    'planner did not retain the reviewed readability floor');
  assert(plan.readabilityBoostedFootprints === 2 && plan.readabilityCappedFootprints === 0,
    'planner reported the wrong bounded readability boosts');
  const plannedCorners = flattenUvFaceCorners(plan.rects)!;
  const naturalCorners = [...plannedCorners.slice(18, 24)];
  const naturalXs = [naturalCorners[0]!, naturalCorners[2]!, naturalCorners[4]!];
  const naturalYs = [naturalCorners[1]!, naturalCorners[3]!, naturalCorners[5]!];
  assert(Math.abs(Math.max(...naturalXs) - Math.min(...naturalXs) - 20) < 0.0001 &&
    Math.abs(Math.max(...naturalYs) - Math.min(...naturalYs) - 10) < 0.0001,
  'already-readable support footprint lost its natural scale');
  assert(plan.rects[1]!.w > 10 && plan.rects[1]!.h > 10,
    'undersized support footprint did not receive its readability floor');
  assert(plan.aspectClasses.square === 1 && plan.aspectClasses.wide2 === 1 && plan.aspectClasses['wide-sliver'] === 1,
    'uniform cells were not separated into the reviewed aspect bins');
  assert(plan.rects[0]!.x < plan.zones.uniform.x && plan.rects[1]!.x >= plan.zones.uniform.x,
    'hero and uniform footprints did not land in separate atlas zones');
  assert([...plannedCorners.slice(6, 12)].join(',') === [...plannedCorners.slice(12, 18)].join(','),
    'identical uniform parts did not land on literally the same rect');
  assert([...flattenUvFaceCorners(rects)!].join(',') === sourceCorners.join(','), 'mutation-free planner changed its source UV corners');
  assert(uvAspectClass({ w: 9, h: 8 }) === 'square' && uvAspectClass({ w: 30, h: 2 }) === 'wide-sliver',
    'aspect bucket thresholds drifted');
});

test('repeat prestack matches identical coverage despite different triangulation and source bookkeeping', () => {
  const rects = parseUvIslandRects(
    [0, 0, 10, 10, 20, 0, 10, 10],
    [10, 20],
    [
      0, 10, 0, 0, 10, 0, 10, 10,
      0, 10, 0, 0, 10, 10, 0, 10,
      1, 20, 20, 0, 30, 0, 20, 10,
      1, 21, 30, 0, 30, 10, 20, 10,
    ],
    [
      0, 1, 2, 0, 2, 3,
      10, 11, 13, 11, 12, 13,
    ],
  );
  const plan = planRepeatedUvStacks(rects, 'exact', 64, 64);
  assert(plan.groups.length === 1 && plan.groups[0]!.islands.join(',') === '0,1', 'identical coverage was split by source bookkeeping');
  assert(plan.sourceFootprints === 2 && plan.uniqueFootprints === 1, 'identical coverage did not collapse to one texture footprint');
  assert(plan.stackedIslands === 1 && plan.changedIslands === 1, 'coverage family reported the wrong move count');
  assert(plan.rects[0] === rects[0] && plan.rects[1] !== rects[1], 'coverage stack moved the representative or skipped its peer');
  assert(plan.rects[1]!.triangles?.[0]?.group === 20 && plan.rects[1]!.triangles?.[1]?.group === 21, 'coverage stack replaced authored face groups');
  assert(plan.rects[1]!.triangles?.[0]?.vertices?.join(',') === '10,11,13', 'coverage stack replaced welded source identities');
});

test('repeat prestack explicitly walks four turns and horizontal flip plus four turns', () => {
  const orientations = [
    [1, 0, 0, 1],
    [0, -1, 1, 0],
    [-1, 0, 0, -1],
    [0, 1, -1, 0],
    [-1, 0, 0, 1],
    [0, -1, -1, 0],
    [1, 0, 0, -1],
    [0, 1, 1, 0],
  ] as const;
  const source = [
    [0, 0],
    [7, 1],
    [5, 9],
    [1, 6],
  ] as const;
  const bounds: number[] = [];
  const groups: number[] = [];
  const triangles: number[] = [];
  const vertices: number[] = [];
  orientations.forEach(([xx, xy, yx, yy], island) => {
    const transformed = source.map(([x, y]) => ({
      x: xx * x + xy * y,
      y: yx * x + yy * y,
    }));
    const lowX = Math.min(...transformed.map((point) => point.x));
    const lowY = Math.min(...transformed.map((point) => point.y));
    const highX = Math.max(...transformed.map((point) => point.x));
    const highY = Math.max(...transformed.map((point) => point.y));
    const offsetX = island * 16 - lowX;
    const offsetY = (island % 2) * 16 - lowY;
    const points = transformed.map((point) => ({
      x: point.x + offsetX,
      y: point.y + offsetY,
    }));
    bounds.push(
      island * 16,
      (island % 2) * 16,
      highX - lowX,
      highY - lowY,
    );
    groups.push(100 + island);
    triangles.push(
      island, 100 + island,
      points[0]!.x, points[0]!.y,
      points[1]!.x, points[1]!.y,
      points[2]!.x, points[2]!.y,
      island, 100 + island,
      points[0]!.x, points[0]!.y,
      points[2]!.x, points[2]!.y,
      points[3]!.x, points[3]!.y,
    );
    const vertexBase = island * 10;
    vertices.push(
      vertexBase, vertexBase + 1, vertexBase + 2,
      vertexBase, vertexBase + 2, vertexBase + 3,
    );
  });
  const rects = parseUvIslandRects(bounds, groups, triangles, vertices);
  const plan = planRepeatedUvStacks(rects, 'exact', 256, 64);
  assert(plan.groups.length === 1, `eight-orientation walk split into ${plan.groups.length} families`);
  assert(plan.groups[0]!.islands.join(',') === '0,1,2,3,4,5,6,7', 'one of the eight explicit orientations was missed');
  assert(plan.sourceFootprints === 8 && plan.uniqueFootprints === 1, 'eight-orientation walk did not produce one footprint');
  assert(plan.stackedIslands === 7 && plan.changedIslands === 7, 'eight-orientation walk reported the wrong move count');
  assert(plan.rects[7]!.triangles?.[0]?.vertices?.join(',') === '70,71,72', 'mirrored peer lost its welded source identities');
});

test('repeat prestack absorbs half-texel auto-projection drift on mirrored shells', () => {
  const rects = parseUvIslandRects(
    [0, 0, 134, 275, 200, 0, 134, 275],
    [424, 425],
    [
      0, 424, 52.8974, 274, 19.52145, 182.5419, 124.09973, 182.5419,
      0, 424, 52.8974, 274, 124.09973, 182.5419, 133.00003, 274,
      0, 432, 106.29929, 0, 115.19943, 91.02, 1.72086, 91.02,
      0, 432, 106.29929, 0, 1.72086, 91.02, 0, 0,
      0, 433, 115.19943, 91.02, 124.09973, 182.5419, 19.52145, 182.5419,
      0, 433, 115.19943, 91.02, 19.52145, 182.5419, 1.72086, 91.02,
      1, 425, 208.39594, 182.5419, 312.9744, 182.5419, 279.5983, 274,
      1, 425, 208.39594, 182.5419, 279.5983, 274, 200, 274,
      1, 428, 330.77496, 91.02, 217.2963, 91.02, 226.19653, 0,
      1, 428, 330.77496, 91.02, 226.19653, 0, 333, 0,
      1, 429, 312.9744, 182.5419, 208.39594, 182.5419, 217.2963, 91.02,
      1, 429, 312.9744, 182.5419, 217.2963, 91.02, 330.77496, 91.02,
    ],
  );
  const plan = planRepeatedUvStacks(rects, 'exact', 512, 512);
  assert(plan.groups.length === 1 && plan.groups[0]!.islands.join(',') === '0,1',
    'sub-pixel mirror projection drift split one repeated shell family');
  assert(plan.sourceFootprints === 2 && plan.uniqueFootprints === 1 && plan.changedIslands === 1,
    'sub-pixel mirror family did not land on one exact paint footprint');
  const corners = flattenUvFaceCorners(plan.rects)!;
  const pointSet = (start: number, count: number) => {
    const points: string[] = [];
    for (let at = start; at < start + count; at += 2) points.push(`${corners[at]},${corners[at + 1]}`);
    return [...new Set(points)].sort().join('|');
  };
  assert(pointSet(0, 36) === pointSet(36, 36), 'fuzzy mirror match did not land on the representative corners exactly');
});

test('repeat semantic partitions preserve mirrored left/right twins without merging unrelated surfaces', () => {
  assert(
    uvRepeatSemanticFamily(['legShield.left'], 70) === uvRepeatSemanticFamily(['legShield.right'], 71),
    'explicit left/right semantic twins were split before repeat matching',
  );
  assert(
    uvRepeatSemanticFamily(['legShield.front'], 70) !== uvRepeatSemanticFamily(['legShield.left'], 71),
    'unrelated semantic surfaces were collapsed into one repeat family',
  );
});

test('repeat prestack buckets a production-sized repeated topology sweep into one deterministic family', () => {
  const islandCount = 1024;
  const bounds: number[] = [];
  const groups: number[] = [];
  const triangles: number[] = [];
  const vertices: number[] = [];
  for (let island = 0; island < islandCount; island += 1) {
    const x = (island % 32) * 12;
    const y = Math.floor(island / 32) * 10;
    bounds.push(x, y, 8, 6);
    groups.push(island);
    triangles.push(island, island, x, y, x + 8, y, x, y + 6);
    vertices.push(island * 3, island * 3 + 1, island * 3 + 2);
  }
  const rects = parseUvIslandRects(bounds, groups, triangles, vertices);
  const first = planRepeatedUvStacks(rects, 'exact', 512, 512);
  const second = planRepeatedUvStacks(rects, 'exact', 512, 512);
  assert(first.groups.length === 1 && first.stackedIslands === islandCount - 1, 'large repeat family fragmented during the sweep');
  assert(first.uniqueFootprints === 1 && first.changedIslands === islandCount - 1, 'large repeat preview reported the wrong footprint reduction');
  assert(
    JSON.stringify(first.groups) === JSON.stringify(second.groups),
    'same large topology produced a different repeat-family decision',
  );
});

test('uniform packing keeps exact stacks together as one normalized footprint', () => {
  const source = parseUvIslandRects(
    [0, 0, 10, 20, 30, 0, 20, 10, 60, 0, 8, 8],
    [10, 20, 30],
    [
      0, 10, 0, 0, 10, 0, 10, 20,
      0, 10, 0, 0, 10, 20, 0, 20,
      1, 20, 30, 10, 30, 0, 50, 0,
      1, 20, 30, 10, 50, 0, 50, 10,
      2, 30, 60, 0, 68, 0, 60, 8,
    ],
    [
      0, 1, 2, 0, 2, 3,
      10, 11, 12, 10, 12, 13,
      20, 21, 22,
    ],
  );
  const stacked = planRepeatedUvStacks(source, 'exact', 64, 64).rects;
  assert(countUvTextureFootprints(stacked) === 2, 'exact stack still counted as separate texture footprints');
  const packed = uniformUvPack(stacked, 64, 64);
  assert(countUvTextureFootprints(packed) === 2, 'uniform packing exploded a prestack');
  assert(
    packed[0]!.x === packed[1]!.x
      && packed[0]!.y === packed[1]!.y
      && packed[0]!.w === packed[1]!.w
      && packed[0]!.h === packed[1]!.h,
    'stack members received different normalized cells',
  );
  const corners = flattenUvFaceCorners(packed)!;
  const first = [...corners.slice(0, 12)].map((value, index) => `${index % 2}:${value}`).sort().join('|');
  const second = [...corners.slice(12, 24)].map((value, index) => `${index % 2}:${value}`).sort().join('|');
  assert(first === second, 'uniform packing moved stack members to different authored corners');
});

test('stitching fits a broken UV edge by welded model identity while the active island stays fixed', () => {
  const rects = parseUvIslandRects(
    [10, 10, 10, 10, 30, 30, 10, 20, 50, 50, 4, 4],
    [100, 101, 102],
    [
      0, 100, 10, 10, 20, 10, 10, 20,
      1, 101, 40, 50, 40, 30, 30, 40,
      2, 102, 50, 50, 54, 50, 50, 54,
    ],
    [
      1, 2, 3,
      1, 2, 4,
      50, 51, 52,
    ],
  );
  const result = stitchUvIslands(rects, [0, 1, 2], 0, 64, 64);
  const corners = flattenUvFaceCorners(result.rects)!;
  assert(result.rects[0] === rects[0], 'stitch moved the white active island');
  assert(corners[6] === 10 && corners[7] === 10, 'first welded seam endpoint missed its active UV copy');
  assert(corners[8] === 20 && corners[9] === 10, 'second welded seam endpoint missed its active UV copy');
  assert(corners[10] === 15 && corners[11] === 5, 'moving island did not preserve its handed similarity fit');
  assert(result.stitched === 1 && result.seamEdges === 1 && result.seamVertices === 2, 'stitch report lost the exact seam it joined');
  assert(result.unmatched === 1 && result.blocked === 0, 'unrelated selected island was dragged into the seam component');
});

test('stitching sweeps a selected welded-edge chain beyond the active island', () => {
  const rects = parseUvIslandRects(
    [10, 10, 10, 10, 30, 30, 10, 20, 50, 50, 10, 10],
    [100, 101, 102],
    [
      0, 100, 10, 10, 20, 10, 10, 20,
      1, 101, 40, 50, 40, 30, 30, 40,
      2, 102, 50, 50, 60, 50, 50, 60,
    ],
    [
      1, 2, 3,
      1, 2, 4,
      2, 4, 5,
    ],
  );
  const result = stitchUvIslands(rects, [0, 1, 2], 0, 64, 64);
  const corners = flattenUvFaceCorners(result.rects)!;
  assert(result.stitched === 2 && result.unmatched === 0 && result.blocked === 0, 'selected seam graph stopped after its first neighbour');
  assert(corners[12] === corners[8] && corners[13] === corners[9], 'second-hop seam vertex 2 missed the first stitched island');
  assert(corners[14] === corners[10] && corners[15] === corners[11], 'second-hop seam vertex 4 missed the first stitched island');
  assert(corners[16] === 25 && corners[17] === 5, 'second-hop island lost its handed similarity fit');
});

test('stitching indexes a production-sized seam chain instead of rescanning the selected graph', () => {
  // Torso Female003 currently carries 6,831 render triangles. Treat the
  // all-islands worst case as the regression scale for req_3519.
  const islandCount = 6_831;
  const rects = Array.from({ length: islandCount }, (_unused, index) => ({
    x: 128 + index,
    y: 128,
    w: 2,
    h: 1,
    group: index,
    triangles: [{
      face: index,
      group: index,
      points: index % 2 === 0
        ? [0, 0, 0.5, 1, 1, 0] as const
        : [0, 1, 0.5, 0, 1, 1] as const,
      vertices: [index, index + 1, index + 2] as const,
    }],
  }));
  const result = stitchUvIslands(
    rects,
    rects.map((_rect, index) => index),
    0,
    islandCount + 512,
    512,
  );
  assert(result.stitched === islandCount - 1, `large seam sweep stopped at ${result.stitched}/${islandCount - 1}`);
  assert(result.unmatched === 0 && result.blocked === 0, 'large indexed seam sweep lost part of its connected component');
  assert(result.evaluatedCandidates <= islandCount * 2, `large sweep regressed to repeated pair scans (${result.evaluatedCandidates} evaluations)`);
});

test('point-only stitching accepts one unambiguous pair but refuses a many-island pole', () => {
  const rects = parseUvIslandRects(
    [10, 10, 10, 10, 30, 30, 10, 10, 50, 50, 10, 10],
    [100, 101, 102],
    [
      0, 100, 10, 10, 20, 10, 10, 20,
      1, 101, 30, 30, 40, 30, 30, 40,
      2, 102, 50, 50, 60, 50, 50, 60,
    ],
    [
      1, 2, 3,
      1, 4, 5,
      1, 6, 7,
    ],
  );
  const pair = stitchUvIslands(rects, [0, 1], 0, 64, 64);
  assert(pair.stitched === 1 && pair.seamEdges === 0 && pair.seamVertices === 1, 'one unique point-cut pair did not stitch');
  const pole = stitchUvIslands(rects, [0, 1, 2], 0, 64, 64);
  assert(pole.stitched === 0 && pole.unmatched === 2, 'a many-island pole was arbitrarily folded into one UV blob');
  assert(pole.evaluatedCandidates === 0, 'ambiguous pole entered the automatic fit queue');
});

test('stitching may join an identity match beyond the finite texture rectangle', () => {
  const rects = parseUvIslandRects(
    [10, 0, 10, 10, 30, 30, 10, 20],
    [100, 101],
    [
      0, 100, 10, 0, 20, 0, 10, 10,
      1, 101, 40, 50, 40, 30, 30, 40,
    ],
    [1, 2, 3, 1, 2, 4],
  );
  const result = stitchUvIslands(rects, [0, 1], 0, 64, 64);
  assert(result.stitched === 1 && result.blocked === 0 && result.unmatched === 0, 'signed workspace seam fit was still atlas-blocked');
  assert(result.rects[1] !== rects[1], 'accepted stitch did not move its island');
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

test('move and resize use the signed workspace without requiring text selection', () => {
  const rect = { x: 4, y: 5, w: 8, h: 9, group: 0 };
  const moved = moveUvIsland(rect, 100, -100, 32, 24);
  assert(moved.x === 104 && moved.y === -95, 'move did not cross the former atlas boundary');
  const resized = resizeUvIsland(moved, 100, -100, 32, 24);
  assert(resized.w === 108 && resized.h === 1, 'resize did not retain unbounded width and minimum height');
});

test('four-corner resize keeps the opposite corner fixed', () => {
  const rect = { x: 10, y: 12, w: 20, h: 16, group: 0 };
  const northwest = resizeUvIslandFromCorner(rect, 'nw', 5, -4, 64, 64);
  assert(northwest.x === 15 && northwest.y === 8 && northwest.w === 15 && northwest.h === 20, 'northwest handle moved the fixed corner');
  const southeast = resizeUvIslandFromCorner(rect, 'se', 80, -80, 64, 64);
  assert(southeast.x === 10 && southeast.y === 12 && southeast.w === 100 && southeast.h === 1, 'southeast handle did not cross the former atlas edge');
});

test('offset scale handle starts at one-to-one and follows pointer travel without jumping', () => {
  const bounds = { x: 10, y: 12, w: 20, h: 16, cx: 20, cy: 20 };
  const handle = { x: 37, y: 35 };
  const grabbed = uvScaleDragPoint(bounds, handle, handle);
  assert(grabbed.x === 30 && grabbed.y === 28, 'grabbing the offset scale handle changed the authored corner');
  const dragged = uvScaleDragPoint(bounds, handle, { x: 47, y: 30 });
  assert(dragged.x === 40 && dragged.y === 23, 'scale corner did not follow pointer delta from its gesture seed');
  const rect = parseUvIslandRects([10, 12, 20, 16], [1], [0, 1, 10, 12, 30, 12, 10, 28])[0]!;
  assert(scaleUvSelection(rect, undefined, 1, 1, 64, 64) === rect, 'one-to-one scale grab churned UV geometry');
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

test('UV marquee crosses authored triangle silhouettes without selecting empty bounds', () => {
  const rects = parseUvIslandRects(
    [0, 0, 20, 20, -20, -12, 8, 8],
    [1, 2],
    [
      0, 0, 0, 20, 0, 0, 2,
      1, -20, -12, -12, -12, -16, -4,
    ],
  );
  assert(
    uvIslandsIntersectingMarquee(rects, { x: 11, y: 12 }, { x: 9, y: 10 }).length === 0,
    'marquee selected empty space inside a narrow triangle bounding box',
  );
  assert(
    uvIslandsIntersectingMarquee(rects, { x: 11, y: 1 }, { x: 9, y: -1 }).join(',') === '0',
    'reverse-direction marquee missed a crossed triangle edge',
  );
  assert(
    uvIslandsIntersectingMarquee(rects, { x: -18, y: -10 }, { x: -17, y: -9 }).join(',') === '1',
    'signed-workspace marquee missed a region fully enclosed by a triangle',
  );
});

test('UV marquee catches edge-only crossings and legacy rectangle rows', () => {
  const triangle = parseUvIslandRects(
    [0, 0, 10, 10],
    [1],
    [0, 0, 0, 10, 0, 5, 10],
  )[0]!;
  const rects = [triangle, { x: 20, y: 20, w: 5, h: 5, group: 2 }];
  assert(
    uvIslandsIntersectingMarquee(rects, { x: -1, y: 4.9 }, { x: 11, y: 5.1 }).join(',') === '0',
    'marquee missed a triangle whose edges cross the box without enclosing a box corner',
  );
  assert(
    uvIslandsIntersectingMarquee(rects, { x: 24, y: 24 }, { x: 26, y: 26 }).join(',') === '1',
    'legacy rectangle-only UV island lost its marquee fallback',
  );
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

test('paste transform scales and moves an island to a signed workspace frame', () => {
  const rects = parseUvIslandRects(
    [4, 4, 10, 10],
    [7],
    [0, 4, 4, 14, 4, 4, 14],
  );
  const pasted = pasteUvTransform(rects[0]!, undefined, { x: 30, y: 40, w: 20, h: 5 }, 64, 64);
  const bounds = uvSelectionBounds(pasted);
  assert(Boolean(bounds), 'pasted island lost its silhouette');
  assert(Math.abs(bounds!.x - 30) < 0.001 && Math.abs(bounds!.y - 40) < 0.001, `pasted frame origin drifted (${bounds!.x},${bounds!.y})`);
  assert(Math.abs(bounds!.w - 20) < 0.001 && Math.abs(bounds!.h - 5) < 0.001, `pasted frame size drifted (${bounds!.w}×${bounds!.h})`);
  const outside = pasteUvTransform(rects[0]!, undefined, { x: 60, y: -12, w: 20, h: 5 }, 64, 64);
  const outsideBounds = uvSelectionBounds(outside)!;
  assert(Math.abs(outsideBounds.x - 60) < 0.001 && Math.abs(outsideBounds.y + 12) < 0.001, 'pasted frame was clamped back into the atlas');
});

test('off-texture face and vertex edits preserve signed corner coordinates', () => {
  const rect = parseUvIslandRects([0, 0, 10, 10], [1], [0, 1, 1, 9, 1, 1, 9])[0]!;
  const face = moveUvFace(rect, { face: 0, group: 1 }, -20, 40, 10, 10, 1, true);
  const faceCorners = flattenUvFaceCorners([face])!;
  assert(faceCorners[0] === -19 && faceCorners[1] === 41, 'face translation lost its signed workspace coordinates');
  const vertex = moveUvSelectionVertex(face, undefined, 0, -2, -3, 10, 10, true);
  const vertexCorners = flattenUvFaceCorners([vertex])!;
  assert(vertexCorners[0] === -21 && vertexCorners[1] === 38, 'vertex translation was clamped to the texture');
});

test('visible workspace grid follows pan across negative coordinates', () => {
  const grid = uvWorkspaceGridSegments({ x: 20, y: 12, scale: 2 }, 40, 24, 4);
  const starts = [...grid.minor, ...grid.major].filter((_value, index) => index % 4 === 0);
  assert(starts.includes(-8), 'negative visible grid line was omitted');
  assert(starts.includes(0), 'workspace origin grid line was omitted');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed) throw new Error(`${failed} test(s) failed`);
