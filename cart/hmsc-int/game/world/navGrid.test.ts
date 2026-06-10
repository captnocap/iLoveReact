// navGrid.test.ts — meaning-tests for the nav bake + the floor micro-grid
// (MICROGRID-0610, P4): ground floors project their 3×3 cells into the path
// grid, authored cell overrides land, walls block only the strips their slabs
// cover (0.5m nav cells — the finer-grid law), door openings stay open with NO
// special casing (the collider bands are already split), and a prop blocks its
// footprint by derivation. Pure CPU under tools/v8cli.

import { assert, assertEqual, finish, test } from '../_testkit';
import { TILE_KIND_INDEX } from '../kinds';
import type { PlacedBuildPiece } from '../build/placed';
import { FLOOR_CELL_COUNT, floorCellRects, resolveFloorCells, setFloorCell } from '../build/microGrid';
import { bakeNavGrid, navKindAt, NAV_TUNING } from './navGrid';

let nextId = 0;
function placed(pieceId: string, x: number, z: number, over: Partial<PlacedBuildPiece> = {}): PlacedBuildPiece {
  nextId += 1;
  return { id: `t_${nextId}`, pieceId, x, y: 0, z, yawDegrees: 0, ...over };
}

const MUD = TILE_KIND_INDEX.mud;
const WALK = TILE_KIND_INDEX.sidewalk; // the floor material default
const BLOCK = TILE_KIND_INDEX[NAV_TUNING.blockKind];

function bake(pieces: PlacedBuildPiece[]) {
  return bakeNavGrid({
    origin: [0, 0], cols: 12, rows: 12,
    paintedKinds: new Array(144).fill(-1),
    emptyKind: 'mud',
    pieces,
  });
}

test('a bare floor projects 3×3 walkable cells; unpainted ground paths as emptyKind', () => {
  const grid = bake([placed('floor.concrete.common', 6, 6)]);
  assertEqual(grid.cols, 24, '0.5m nav cells — 2× the painted grid');
  assertEqual(navKindAt(grid, 6, 6), WALK, 'floor centre walks');
  assertEqual(navKindAt(grid, 4.7, 4.7), WALK, 'floor corner walks (3m plate spans 4.5..7.5)');
  assertEqual(navKindAt(grid, 1, 1), MUD, 'off the floor = unpainted ground kind');
});

test('an authored micro-cell override lands on exactly its cell', () => {
  const cells = setFloorCell(undefined, 1, 1, 'bush'); // centre cell
  assertEqual(cells.length, FLOOR_CELL_COUNT, 'always 9 entries');
  const floor = placed('floor.concrete.common', 6, 6, { cells });
  assertEqual(resolveFloorCells(floor)[4], 'bush', 'centre resolves to the override');
  const grid = bake([floor]);
  assertEqual(navKindAt(grid, 6, 6), TILE_KIND_INDEX.bush, 'override cell paths as its kind');
  assertEqual(navKindAt(grid, 5, 6), WALK, 'neighbour cell keeps the material default');
});

test('floorCellRects honors quarter-turn rotation', () => {
  const cells = setFloorCell(undefined, 0, 0, 'bush'); // local north-west cell
  const r0 = floorCellRects(placed('floor.concrete.common', 6, 6, { cells }))
    .find((r) => r.kind === 'bush')!;
  assert(r0.minX < 6 && r0.minZ < 6, 'yaw 0: the cell sits at -x,-z of centre');
  const r90 = floorCellRects(placed('floor.concrete.common', 6, 6, { cells, yawDegrees: 90 }))
    .find((r) => r.kind === 'bush')!;
  assert(r90.minX >= 6 - 0.001 && r90.minZ < 6, 'one quarter turn moves it to +x,-z');
});

test('a wall blocks only the strips its slab covers; rooms keep their width', () => {
  // Wall (3m × 0.25m) along the floor's north edge at z=4.5.
  const grid = bake([
    placed('floor.concrete.common', 6, 6),
    placed('wall.concrete.common', 6, 4.5),
  ]);
  assertEqual(navKindAt(grid, 6, 4.3), BLOCK, 'the strip north of the slab blocks');
  assertEqual(navKindAt(grid, 6, 4.7), BLOCK, 'the strip south of the slab blocks');
  assertEqual(navKindAt(grid, 6, 5.3), WALK, 'half a meter in, the room walks — no 1m bite');
  assertEqual(navKindAt(grid, 6, 6), WALK, 'room interior untouched');
});

test('a door opening stays walkable with no special casing', () => {
  const grid = bake([
    placed('floor.concrete.common', 6, 6),
    placed('wall.concrete.common', 6, 7.5, { edit: 'door' }),
  ]);
  assert(navKindAt(grid, 6, 7.4) !== BLOCK, 'the doorway cells stay open (split bands)');
  assertEqual(navKindAt(grid, 4.8, 7.4), BLOCK, 'the wall beside the door still blocks');
});

test("a prop blocks its footprint by derivation — the user's dresser rule", () => {
  const grid = bake([
    placed('floor.concrete.common', 6, 6),
    placed('prop.dumpster', 6, 6),
  ]);
  assertEqual(navKindAt(grid, 6, 6), BLOCK, 'under the prop = blocked');
  assertEqual(navKindAt(grid, 4.7, 4.7), WALK, 'the rest of the floor still walks');
  const without = bake([placed('floor.concrete.common', 6, 6)]);
  assertEqual(navKindAt(without, 6, 6), WALK, 'remove the prop, the cells free themselves');
});

test('elevated floors are excluded until surface-nav (the y gate)', () => {
  const grid = bake([placed('floor.concrete.common', 6, 6, { y: 3 })]);
  assertEqual(navKindAt(grid, 6, 6), MUD, 'a second-story floor does not paint the ground grid');
});

test('a ramp footprint paths as a walkable link', () => {
  const grid = bake([placed('ramp.concrete.common', 6, 6)]);
  assertEqual(navKindAt(grid, 6, 6), TILE_KIND_INDEX[NAV_TUNING.linkKind], 'ramp surface walks');
});

finish('navGrid');
