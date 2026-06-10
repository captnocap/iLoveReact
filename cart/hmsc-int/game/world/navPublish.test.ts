// navPublish.test.ts — meaning-tests for the live nav publish (NAVLIVE-0610,
// P4): painted landform tile grids fold into one world grid at the right
// offsets, the kind tables derive flows/classes/costs straight off the
// registry, the host cap windows the bake around the anchor instead of
// silently skipping, and the publish runs headless (host bindings absent →
// generation 0, everything else intact). Pure CPU under tools/v8cli.

import { assert, assertEqual, finish, test } from '../_testkit';
import { TILE_KIND_INDEX, TILE_KINDS } from '../kinds';
import { PATH_CLASS, PATH_FLOW } from '../pathing';
import type { LandformPlacement } from './grid';
import {
  clipPaintedGrid, navClassTable, navFlowTable, navProfileCosts, NAV_PROFILES,
  paintedGridFromLandforms, PATHING_GRID_LIMITS, publishNavGrid,
} from './navPublish';

function paintedChunk(cx: number, cz: number, side: number, fillKind: number): LandformPlacement {
  const idx = new Array(side * side).fill(fillKind);
  return {
    id: `painted_${cx}_${cz}`,
    kind: 'heightfield',
    centerX: cx * side + side / 2,
    centerZ: cz * side + side / 2,
    baseY: 0,
    params: {},
    field: { cols: 2, rows: 2, cell: side, heights: [0, 0, 0, 0], tiles: { cols: side, rows: side, idx } },
  } as LandformPlacement;
}

test('paintedGridFromLandforms folds chunk tile grids at world offsets', () => {
  const SIDE = 8;
  const g = paintedGridFromLandforms([
    paintedChunk(0, 0, SIDE, TILE_KIND_INDEX.sidewalk),
    paintedChunk(1, 0, SIDE, TILE_KIND_INDEX.asphalt),
  ]);
  assert(g !== null, 'two painted chunks produce a grid');
  assertEqual(g!.origin[0], 0, 'origin at the first chunk');
  assertEqual(g!.cols, SIDE * 2, 'bounding rect spans both chunks');
  assertEqual(g!.rows, SIDE, 'one chunk tall');
  assertEqual(g!.kinds[0], TILE_KIND_INDEX.sidewalk, 'chunk 0 cells land at their offset');
  assertEqual(g!.kinds[SIDE], TILE_KIND_INDEX.asphalt, 'chunk 1 cells land at theirs');
  assertEqual(paintedGridFromLandforms([]), null, 'nothing painted = null');
});

test('clipPaintedGrid windows around the anchor and clamps to the grid', () => {
  const SIDE = 16;
  const g = paintedGridFromLandforms([paintedChunk(0, 0, SIDE, TILE_KIND_INDEX.mud)])!;
  const w = clipPaintedGrid(g, [4, 4], 8);
  assertEqual(w.cols, 8, 'window side');
  assertEqual(w.origin[0], 0, 'clamped at the grid edge');
  const w2 = clipPaintedGrid(g, [15, 15], 8);
  assertEqual(w2.origin[0], 8, 'clamped at the far edge');
  assertEqual(w2.kinds.length, 64, 'window cells copied');
});

test('navFlowTable derives PATH_FLOW codes from each kind flow (north = -Z)', () => {
  const flows = navFlowTable();
  assertEqual(flows[TILE_KIND_INDEX.laneNorth], PATH_FLOW.negZ, 'laneNorth flows -Z');
  assertEqual(flows[TILE_KIND_INDEX.laneSouth], PATH_FLOW.posZ, 'laneSouth flows +Z');
  assertEqual(flows[TILE_KIND_INDEX.laneEast], PATH_FLOW.posX, 'laneEast flows +X');
  assertEqual(flows[TILE_KIND_INDEX.laneWest], PATH_FLOW.negX, 'laneWest flows -X');
  assertEqual(flows[TILE_KIND_INDEX.sidewalk], PATH_FLOW.none, 'sidewalk is flow-neutral');
  assertEqual(flows.length, TILE_KINDS.length, 'one code per kind');
});

test('navClassTable marks junction + crosswalk, everything else plain', () => {
  const classes = navClassTable();
  assertEqual(classes[TILE_KIND_INDEX.junction], PATH_CLASS.junction, 'junction class');
  assertEqual(classes[TILE_KIND_INDEX.crosswalk], PATH_CLASS.crosswalk, 'crosswalk class');
  assertEqual(classes[TILE_KIND_INDEX.sidewalk], PATH_CLASS.plain, 'sidewalk plain');
});

test('navProfileCosts: registry costs, impassable ships as -1', () => {
  const walker = navProfileCosts('walker');
  assert(walker[TILE_KIND_INDEX.sidewalk] > 0, 'sidewalk walks');
  assertEqual(walker[TILE_KIND_INDEX.wall], -1, 'wall is impassable (Infinity → -1)');
  assertEqual(walker[TILE_KIND_INDEX.water], -1, 'water is impassable for the walker');
  const vehicle = navProfileCosts('vehicle');
  assert(vehicle[TILE_KIND_INDEX.laneNorth] > 0, 'lanes drive');
  assert(
    vehicle[TILE_KIND_INDEX.laneNorth] < vehicle[TILE_KIND_INDEX.sidewalk] || vehicle[TILE_KIND_INDEX.sidewalk] === -1,
    'vehicles prefer lanes over sidewalks',
  );
});

test('publishNavGrid windows an over-cap map and reports it (no silent caps)', () => {
  // One 120-tile painted chunk = 57,600 nav cells at 0.5m — over the 16,384
  // host cap, so the publish must window, not skip and not coarsen.
  const r = publishNavGrid({
    landforms: [paintedChunk(0, 0, 120, TILE_KIND_INDEX.sidewalk)],
    center: [60, 60],
  });
  assert(r.windowed, 'over-cap map publishes windowed');
  assert(r.cols * r.rows <= PATHING_GRID_LIMITS.cells, 'window fits the host cap');
  assertEqual(r.generation, 0, 'headless: host bindings absent → generation 0');
  assert(r.grid !== null, 'the baked grid still returns for callers');
  assertEqual(r.grid!.kinds[0], TILE_KIND_INDEX.sidewalk, 'window carries the paint');
});

test('publishNavGrid ships small maps whole', () => {
  const r = publishNavGrid({ landforms: [paintedChunk(0, 0, 16, TILE_KIND_INDEX.mud)] });
  assert(!r.windowed, 'a 16-tile map fits whole');
  assertEqual(r.cols, 32, '0.5m cells = 2× the painted grid');
  assertEqual(NAV_PROFILES.walker, 0, 'walker profile id is stable');
});

finish('navPublish');
