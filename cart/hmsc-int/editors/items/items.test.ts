// items.test.ts — P4 behavior tests for the /items sculpt editor's headless
// core (ITEMSCULPT-0606): the voxel→Globe bake (occupancy in → deterministic
// displacement field out), compose-with-sculpt on the ONE grid truth, the
// paint-texture round trip, the registry door, and the V20 'items' stream
// through a real on-disk store in a scratch root (never the live data/).

import { openStore } from '../../data';
import { globeSurface } from '@reactjit/geometries';
import { ITEM_GEOMETRIES } from '../../game/items';
import { applyGrabStamp, cellUv, stampRadiusUv } from '../characters/grabKit';
import { PAINT_EDITOR_TUNING, bytesFromGrid, gridFromBytes } from '../characters/paintKit';
import { ITEM_BAKE_TUNING, ITEM_DRAFT_DEFAULTS, bakeBlockoutToGlobe, emptyItemGrid, itemGlobeParams, sculptedItemDefinition } from './bake';
import { itemsStream, mintItemId, type ItemsStreamState, type SculptedItemDoc } from './stream';
import type { VoxelBlockoutDoc } from '../voxels/stream';
import { assert, assertClose, assertEqual, finish, test } from '../../game/_testkit';

declare const globalThis: any;

const ROOT = 'zig-out/game/test-items-editor';
const GRID_W = PAINT_EDITOR_TUNING.grid.width;
const GRID_H = PAINT_EDITOR_TUNING.grid.height;

function wipeScratch(): void {
  for (const path of [
    `${ROOT}/streams/items.jsonl`,
    `${ROOT}/snapshots/items.snapshot.json`,
  ]) globalThis.__fs_remove?.(path);
}

function blockout(blocks: Array<[number, number, number]>, dims = { w: 8, d: 8, h: 8 }): VoxelBlockoutDoc {
  return {
    dims,
    blocks: blocks.map(([x, y, z], i) => ({ id: 1000 + i, x, y, z, kind: 'wall' as const })),
  };
}

/** the grid cell whose center direction best matches a world direction */
function cellToward(dx: number, dy: number, dz: number): { gx: number; gy: number } {
  let best = { gx: 0, gy: 0 };
  let bestDot = -Infinity;
  const l = Math.hypot(dx, dy, dz);
  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      const { cu, cv } = cellUv(gx, gy);
      const theta = Math.PI * cv;
      const phi = Math.PI / 2 - 2 * Math.PI * cu;
      const d = [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)];
      const dot = (d[0] * dx + d[1] * dy + d[2] * dz) / l;
      if (dot > bestDot) { bestDot = dot; best = { gx, gy }; }
    }
  }
  return best;
}

const at = (g: number[], gx: number, gy: number) => g[gy * GRID_W + gx];
/** the baked radial extent at a cell, meters (inverts the field encoding) */
const extentAt = (bake: { radius: number; amount: number; grid: number[] }, gx: number, gy: number) =>
  bake.radius + bake.amount * at(bake.grid, gx, gy);

test('the bake is deterministic and shaped right: cube → bounded flat-ish field', () => {
  assertEqual(bakeBlockoutToGlobe(null), null, 'no document bakes nothing');
  assertEqual(bakeBlockoutToGlobe(blockout([])), null, 'an empty blockout bakes nothing');

  // a 3×3×3 solid cube centered at (3,3,3)
  const cells: Array<[number, number, number]> = [];
  for (let x = 2; x <= 4; x++) for (let y = 2; y <= 4; y++) for (let z = 2; z <= 4; z++) cells.push([x, y, z]);
  const doc = blockout(cells);
  const a = bakeBlockoutToGlobe(doc)!;
  const b = bakeBlockoutToGlobe(doc)!;
  assertEqual(JSON.stringify(a), JSON.stringify(b), 'the same blockout always bakes the same field');

  assertEqual(a.grid.length, GRID_W * GRID_H, 'the field is the sculpt grid');
  assertEqual(a.misses, 0, 'the centroid sits inside a solid cube — every ray hits');
  assert(a.grid.every((v) => v >= -1 && v <= 1), 'the field stays in the signed sculpt range');
  assert(a.radius > 1 && a.radius < 3, `the base radius is the cube's mean extent (got ${a.radius})`);
  // flat-ish: a cube's face/corner extents differ by less than the radius —
  // the steps arrive as soft bumps for the sculpt to flatten, not spikes
  let lo = Infinity, hi = -Infinity;
  for (let gy = 0; gy < GRID_H; gy++) for (let gx = 0; gx < GRID_W; gx++) {
    const e = extentAt(a, gx, gy);
    lo = Math.min(lo, e); hi = Math.max(hi, e);
  }
  assert(hi - lo < a.radius, `the cube's field spread stays under the base radius (${(hi - lo).toFixed(2)} < ${a.radius.toFixed(2)})`);
  // symmetric mass → symmetric field across the front meridian
  const left = cellToward(1, 0, 0), right = cellToward(-1, 0, 0);
  assertClose(extentAt(a, left.gx, left.gy), extentAt(a, right.gx, right.gy), 0.3, 'a centered cube bakes symmetric flanks');
});

test('off-center mass shifts the field: the arm side reaches farther', () => {
  // a vertical column with one +X arm at its middle — the classic L
  const a = bakeBlockoutToGlobe(blockout([[0, 1, 0], [0, 2, 0], [0, 3, 0], [1, 2, 0], [2, 2, 0]]))!;
  const toArm = cellToward(1, 0, 0);
  const away = cellToward(-1, 0, 0);
  const armR = extentAt(a, toArm.gx, toArm.gy);
  const awayR = extentAt(a, away.gx, away.gy);
  assert(armR > awayR + 0.5, `the +X arm reads farther than the bare −X flank (${armR.toFixed(2)} vs ${awayR.toFixed(2)})`);
  // the documented star-shape limit, asserted as REAL: the centroid sits
  // pulled toward the arm (x≈0.6), so a straight-up ray passes beside the
  // x=0 column and the wrap can't see its top — concave/off-axis features
  // flatten toward the hull instead of spiking
  const up = cellToward(0, 1, 0);
  assert(extentAt(a, up.gx, up.gy) < armR, 'the off-axis column top reads SHORTER than the arm (the surfaced wrap limit)');
});

test('amount never bakes dead: a single block still sculpts', () => {
  const a = bakeBlockoutToGlobe(blockout([[3, 1, 3]]))!;
  const T = ITEM_BAKE_TUNING;
  assert(a.amount >= T.amountMin, 'the absolute amount floor holds');
  assert(a.amount >= a.radius * T.amountMinFracOfRadius - 1e-9, 'the radius-fraction floor holds');
  assert(a.radius > 0.3 && a.radius < 1.2, `one cube bakes a sub-meter item (got ${a.radius})`);
});

test('compose on one truth: a grab stamp moves the baked surface, and only there', () => {
  const cells: Array<[number, number, number]> = [];
  for (let x = 2; x <= 4; x++) for (let y = 1; y <= 5; y++) for (let z = 2; z <= 4; z++) cells.push([x, y, z]);
  const bake = bakeBlockoutToGlobe(blockout(cells))!;
  const params = itemGlobeParams(bake);
  const { rx, ry } = stampRadiusUv(14, PAINT_EDITOR_TUNING.paint.width);
  const cell = cellUv(12, 12);
  const stamped = applyGrabStamp(bake.grid, cell.cu, cell.cv, rx, ry, 0.6, false);
  assert(stamped !== bake.grid, 'the stamp writes a copy, never the bake in place');

  const before = globeSurface(params)(cell.cu, cell.cv);
  const after = globeSurface({ ...params, displace: stamped })(cell.cu, cell.cv);
  const moved = Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]);
  assertClose(moved, bake.amount * (at(stamped, 12, 12) - at(bake.grid, 12, 12)), 0.02, 'the pulled cell moves by amount × the stamped delta, along the surface');

  const farCell = cellUv(40, 4);
  const farBefore = globeSurface(params)(farCell.cu, farCell.cv);
  const farAfter = globeSurface({ ...params, displace: stamped })(farCell.cu, farCell.cv);
  assertClose(Math.hypot(farAfter[0] - farBefore[0], farAfter[1] - farBefore[1], farAfter[2] - farBefore[2]), 0, 1e-9, 'outside the stamp the baked surface is untouched');
});

test('the baked field survives the paint-texture round trip (the depth canvas edits it)', () => {
  const bake = bakeBlockoutToGlobe(blockout([[1, 1, 1], [2, 1, 1], [2, 2, 1], [1, 1, 2]]))!;
  const back = gridFromBytes(bytesFromGrid(bake.grid));
  for (const i of [0, 200, 500, 800, 1100]) {
    assertClose(back[i], bake.grid[i], 0.02, `cell ${i} survives R8 quantization`);
  }
});

test('the registry door: a sculpted item IS an ItemDefinition the renderer resolves', () => {
  const doc: SculptedItemDoc = {
    kind: 'sculpted-item', version: 1, name: 'smoothed crate',
    radius: 0.8, amount: 0.4, cols: GRID_W, rows: GRID_H,
    grid: emptyItemGrid(), color: ITEM_DRAFT_DEFAULTS.color,
    source: { blocks: 9, dims: { w: 5, d: 6, h: 7 } },
  };
  const def = sculptedItemDefinition('itm-test', doc);
  assertEqual(def.id, 'itm-test', 'the stream id is the item id');
  assertEqual(def.parts.length, 1, 'one globe part carries the whole sculpt');
  assert(def.parts[0].geometry in ITEM_GEOMETRIES, 'the globe geometry resolves in the registry vocabulary');
  assertEqual(def.heldScale, 1, 'sculpted items are real meters — no gallery hand-scale');
  assertEqual(def.scaleStatus, 'unaudited', 'the V11 scale audit stays the user\'s verdict');
  assertEqual((def.parts[0].params as any).displace, doc.grid, 'the part renders the document grid (one truth, no copy)');
});

test('the items stream: authored/removed fold + on-disk round trip (V20)', () => {
  let state: ItemsStreamState = itemsStream.initial();
  const doc: SculptedItemDoc = {
    kind: 'sculpted-item', version: 1, name: 'bat',
    radius: 0.5, amount: 0.3, cols: GRID_W, rows: GRID_H,
    grid: emptyItemGrid(), color: '#d8b56a', source: null,
  };
  state = itemsStream.apply(state, { kind: 'authored', id: 'a', doc });
  state = itemsStream.apply(state, { kind: 'authored', id: 'b', doc: { ...doc, name: 'bottle' } });
  state = itemsStream.apply(state, { kind: 'authored', id: 'a', doc: { ...doc, name: 'bat v2' } });
  assertEqual(state.order.join(','), 'a,b', 're-saving keeps the roster position');
  assertEqual(state.items.a.name, 'bat v2', 'authored upserts');
  state = itemsStream.apply(state, { kind: 'removed', id: 'b' });
  assertEqual(state.order.join(','), 'a', 'removed deletes');
  const same = itemsStream.apply(state, { kind: 'futureTool', detail: 1 } as any);
  assertEqual(same.items.a.name, 'bat v2', 'a future event kind passes through untouched');

  wipeScratch();
  const store = openStore(ROOT);
  const channel = store.defineStream(itemsStream);
  channel.append({ kind: 'authored', id: 'hero', doc });
  const checkpoint = store.undoPoint();
  channel.append({ kind: 'authored', id: 'hero', doc: { ...doc, name: 'bat final' } });
  store.materializeSnapshots();

  const snapshot = openStore(ROOT).loadSnapshot<ItemsStreamState>('items');
  assert(snapshot !== null, 'the items snapshot exists');
  assertEqual(snapshot!.state.items.hero.name, 'bat final', 'the restored item is the latest save');
  assertEqual(channel.stateAt(checkpoint).items.hero.name, 'bat', 'the undo point steps back to the earlier save');

  const a = mintItemId();
  const b = mintItemId();
  assert(a.startsWith('itm-') && a !== b, 'minted ids are namespaced and distinct');
});

finish('editors/items');
