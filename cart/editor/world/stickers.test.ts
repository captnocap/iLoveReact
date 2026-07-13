// cart/editor/world/stickers.test.ts — the sticker stamp contract (req_3025):
// rotatePackedTexture re-lays the pixel grid losslessly, and stickerLocalFrom /
// pieceSkinBoxes are exact inverses — a stamp renders where the ray touched,
// at the sticker's true meter size, on every piece yaw.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/world/stickers.test.ts --bundle \
//     --outfile=/tmp/editor-stickers.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit/runtime=$ROOT/runtime \
//     --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-stickers.test.js

import { pieceSkinBoxes, stickerLocalFrom } from './pieceSkins';
import { rotatePackedTexture } from '../textures/pixelTexture';
import { registerStickers } from '../data/stickerStore';
import { registerImportedSpecs } from '../textures/shaders';
import type { PlacedPiece } from './pieces';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(s + '\n'));
function test(name: string, fn: () => void) {
  try { fn(); passed++; log(`  ok  ${name}`); }
  catch (e) { failed++; log(`FAIL  ${name}: ${(e as Error).message}`); }
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }
function near(a: number, b: number, m: string, eps = 1e-6) {
  if (Math.abs(a - b) > eps) throw new Error(`${m}: ${a} vs ${b}`);
}

// ── rotatePackedTexture ────────────────────────────────────────────────────────

// 2x3 palette-mode grid, cells 0..5 reading row-major:  0 1
//                                                       2 3
//                                                       4 5
const GRID = [2, 3, 2, /*palette*/ 1, 0, 0, 0, 1, 0, /*cells*/ 0, 1, 2, 3, 4, 5];

test('rot 0 is identity (same array back)', () => {
  assert(rotatePackedTexture(GRID, 0) === GRID, 'no copy at rot 0');
});

test('rot 1 (90 cw) — 2x3 becomes 3x2, columns become rows', () => {
  const r = rotatePackedTexture(GRID, 1);
  assert(r[0] === 3 && r[1] === 2, `dims swapped, got ${r[0]}x${r[1]}`);
  // 90 cw: dst row 0 = src column 0 bottom-up → 4 2 0; dst row 1 → 5 3 1.
  assert(r.slice(9).join(',') === '4,2,0,5,3,1', `cells ${r.slice(9).join(',')}`);
});

test('rot 2 reverses the grid; rot 3 = inverse of rot 1', () => {
  const r2 = rotatePackedTexture(GRID, 2);
  assert(r2.slice(9).join(',') === '5,4,3,2,1,0', `rot2 cells ${r2.slice(9).join(',')}`);
  const back = rotatePackedTexture(rotatePackedTexture(GRID, 1), 3);
  assert(back.slice(9).join(',') === '0,1,2,3,4,5', 'rot1 then rot3 round-trips');
});

test('raw mode (k=0) rotates 3-float cells as units', () => {
  // 2x1 raw grid: cell A=(.1,.2,.3) B=(.4,.5,.6)
  const raw = [2, 1, 0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
  const r = rotatePackedTexture(raw, 1); // → 1x2, A above B → B first? 90cw of a row: dst col becomes row top-down = A then B reversed
  assert(r[0] === 1 && r[1] === 2, 'dims swapped');
  near(r[3]!, 0.1, 'first cell r'); near(r[6]!, 0.4, 'second cell r');
});

// ── stamp round-trip through pieceSkinBoxes ───────────────────────────────────

const STICKER_W = 0.1016, STICKER_H = 0.1524; // the 4x6 label
registerStickers([{ version: 1, id: 'stk-test', name: 'test', textureId: 'img-test', widthMeters: STICKER_W, heightMeters: STICKER_H }]);
registerImportedSpecs([{
  id: 'img-test', label: 'test', group: 'Imported', blurb: '', shader: 'SHADER', base: [],
  variants: [{ id: 'v0', label: 'Source', value: 0, params: [] }],
  buildData: () => [1, 1, 1, 1, 0, 0, 0],
  slots: [],
} as any]);

function placedWall(yawDegrees: number): PlacedPiece {
  return { id: 'p1', pieceId: 'wall.brick.downtown', x: 4, y: 0, z: 7, yawDegrees };
}

function stampAt(piece: PlacedPiece, point: { x: number; y: number; z: number }, normal: { x: number; y: number; z: number }, rot = 0) {
  const local = stickerLocalFrom(piece, point, normal);
  const withSticker: PlacedPiece = {
    ...piece,
    stickers: [{ id: 's1', stickerId: 'stk-test', role: 'front', ...local, scale: 1, rot }],
  };
  const push = pieceSkinBoxes([withSticker]);
  const f = new Float32Array(push.boxes.buffer, 0, 7);
  return { push, box: { cx: f[0]!, cy: f[1]!, cz: f[2]!, sx: f[3]!, sy: f[4]!, sz: f[5]!, yaw: f[6]! } };
}

test('yaw 0 wall, +z face — box floats at the hit point, sticker-sized, thin in z', () => {
  const piece = placedWall(0);
  const { push, box } = stampAt(piece, { x: 4.2, y: 1.3, z: 7.1 }, { x: 0, y: 0, z: 1 });
  assert(push.materials.length === 1, 'one sticker material');
  near(box.cx, 4.2, 'cx'); near(box.cy, 1.3, 'cy');
  assert(box.cz > 7.1 && box.cz < 7.12, `cz nudged outward, got ${box.cz}`);
  near(box.sx, STICKER_W, 'sx = sticker width'); near(box.sy, STICKER_H, 'sy = sticker height');
  assert(box.sz < 0.01, 'thin in z');
});

test('yaw 90 wall — the same face plane; center returns to the hit point', () => {
  const piece = placedWall(90);
  const { box } = stampAt(piece, { x: 4.3, y: 0.8, z: 7 }, { x: 1, y: 0, z: 0 });
  near(box.cy, 0.8, 'cy');
  near(box.cz, 7, 'cz back at the hit');
  assert(box.cx > 4.3 && box.cx < 4.32, `cx nudged outward along +x, got ${box.cx}`);
  assert(box.yaw === 90, 'box rides the piece yaw');
});

test('quarter-turn stamp swaps the footprint', () => {
  const piece = placedWall(0);
  const { box } = stampAt(piece, { x: 4, y: 1, z: 7.1 }, { x: 0, y: 0, z: 1 }, 1);
  near(box.sx, STICKER_H, 'width takes the sticker height');
  near(box.sy, STICKER_W, 'height takes the sticker width');
});

test('top face (floor) — thin in y, footprint in the ground plane', () => {
  const piece: PlacedPiece = { id: 'p2', pieceId: 'floor.concrete.common', x: 0, y: 0, z: 0, yawDegrees: 0 };
  const { box } = stampAt(piece, { x: 0.3, y: 0.2, z: -0.2 }, { x: 0, y: 1, z: 0 });
  assert(box.sy < 0.01, 'thin in y');
  near(box.sx, STICKER_W, 'sx'); near(box.sz, STICKER_H, 'sz');
  assert(box.cy > 0.2, 'lifted off the surface');
});

test('unknown sticker id renders nothing (no box, no material)', () => {
  const piece: PlacedPiece = {
    ...placedWall(0),
    stickers: [{ id: 's9', stickerId: 'stk-gone', role: 'front', lx: 0, ly: 1, lz: 0.1, nx: 0, ny: 0, nz: 1, scale: 1, rot: 0 }],
  };
  const push = pieceSkinBoxes([piece]);
  assert(push.boxes.length === 0 && push.materials.length === 0, 'silently absent');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
