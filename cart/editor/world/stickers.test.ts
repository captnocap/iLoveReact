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
import { pickAuthoredPlacement, type PlacedPiece } from './pieces';
import { setAuthoredPieces } from './authoredRegistry';
import { cacheAuthoredMesh } from './authoredMesh';

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

// ── authored (hand-exported) pieces are stamp targets too (req_3050) ─────────
// The host catalog raycast can't see model: pieces; the JS AABB pick now names
// the entry face, so a stamp on an authored wall round-trips like any catalog hit.

test('authored piece at yaw 90 — AABB pick names the hit face; the stamp lands on it', () => {
  setAuthoredPieces([{ id: 'model:test-wall', modelId: 'test-wall', pkgId: 'pkg-test', label: 'Test Wall', kind: 'wall' } as any]);
  // Two corner verts (pos3+normal3+uv2 stride) are enough to define the AABB:
  // a 3m-wide, 3m-tall, 0.2m-thick wall centered on x/z.
  cacheAuthoredMesh('test-wall', new Float32Array([
    -1.5, 0, -0.1, 0, 0, 1, 0, 0,
    1.5, 3, 0.1, 0, 0, 1, 1, 1,
  ]));
  const piece: PlacedPiece = { id: 'a1', pieceId: 'model:test-wall', x: 10, y: 0, z: 5, yawDegrees: 90 };
  // At yaw 90 the wall's thin axis lies along world x; approach from -x.
  const ray = { origin: { x: 5, y: 1.5, z: 5 }, dir: { x: 1, y: 0, z: 0 } };
  const hit = pickAuthoredPlacement(ray, [piece], 1000);
  assert(!!hit, 'authored pick hits');
  near(hit!.point.x, 9.9, 'hit point on the -x face plane');
  assert(!!hit!.normal, 'entry face names a normal');
  near(hit!.normal!.x, -1, 'outward normal faces the ray');
  const local = stickerLocalFrom(piece, hit!.point, hit!.normal!);
  const withSticker: PlacedPiece = {
    ...piece,
    stickers: [{ id: 's2', stickerId: 'stk-test', role: 'surface', ...local, scale: 1, rot: 0 }],
  };
  const push = pieceSkinBoxes([withSticker]);
  assert(push.materials.length === 1, 'sticker material resolves on an authored piece');
  const f = new Float32Array(push.boxes.buffer, 0, 7);
  near(f[0]!, 9.9 - 0.008, 'box floats 8mm off the hit face');
  near(f[1]!, 1.5, 'cy at the hit height');
  near(f[2]!, 5, 'cz at the hit');
  // The row carries yaw 90: the face normal is LOCAL z, so the thin slot is sz.
  assert(f[5]! < 0.01, 'thin along the face normal (local z under yaw 90)');
});

test('overlapping stamps stack by stamp order — each lifts a step above what it covers', () => {
  const base = placedWall(0);
  const local = stickerLocalFrom(base, { x: 4, y: 1, z: 7.1 }, { x: 0, y: 0, z: 1 });
  const piece: PlacedPiece = {
    ...base,
    stickers: [0, 1, 2].map((i) => ({ id: `s${i}`, stickerId: 'stk-test', role: 'front', ...local, scale: 1, rot: 0 })),
  };
  const push = pieceSkinBoxes([piece]);
  const f = new Float32Array(push.boxes.buffer);
  const cz0 = f[2]!, cz1 = f[8 + 2]!, cz2 = f[16 + 2]!;
  near(cz1 - cz0, 0.002, 'second stamp sits one step above the first');
  near(cz2 - cz1, 0.002, 'third above the second');
});

test('a collage of NON-touching stamps stays flush — no lift without overlap (req_3051)', () => {
  const base = placedWall(0);
  // Three stamps spread across the wall, each ~0.3m apart — a 4x6 label is
  // ~0.1m wide, so nothing touches.
  const spots = [3.2, 3.9, 4.6].map((x) => stickerLocalFrom(base, { x, y: 1, z: 7.1 }, { x: 0, y: 0, z: 1 }));
  const piece: PlacedPiece = {
    ...base,
    stickers: spots.map((local, i) => ({ id: `s${i}`, stickerId: 'stk-test', role: 'front', ...local, scale: 1, rot: 0 })),
  };
  const push = pieceSkinBoxes([piece]);
  const f = new Float32Array(push.boxes.buffer);
  near(f[2]!, f[8 + 2]!, 'all flush at the base lift');
  near(f[8 + 2]!, f[16 + 2]!, 'all flush at the base lift');
});

test('a touching CHAIN climbs only along the chain; a later isolated stamp resets to flush', () => {
  const base = placedWall(0);
  // a and b overlap (5cm apart); c overlaps b but not a; d is far away.
  const at = (x: number) => stickerLocalFrom(base, { x, y: 1, z: 7.1 }, { x: 0, y: 0, z: 1 });
  const piece: PlacedPiece = {
    ...base,
    stickers: [at(4.0), at(4.05), at(4.1), at(5.5)].map((local, i) => (
      { id: `s${i}`, stickerId: 'stk-test', role: 'front', ...local, scale: 1, rot: 0 })),
  };
  const push = pieceSkinBoxes([piece]);
  const f = new Float32Array(push.boxes.buffer);
  const cz = (i: number) => f[i * 8 + 2]!;
  near(cz(1) - cz(0), 0.002, 'b one step over a');
  near(cz(2) - cz(1), 0.002, 'c one step over b (chained through the overlap)');
  near(cz(3), cz(0), 'the isolated d sits flush at the base lift');
});

test('ray starting inside the authored box yields no stampable face', () => {
  const piece: PlacedPiece = { id: 'a2', pieceId: 'model:test-wall', x: 0, y: 0, z: 0, yawDegrees: 0 };
  const hit = pickAuthoredPlacement({ origin: { x: 0, y: 1, z: 0 }, dir: { x: 0, y: 0, z: 1 } }, [piece], 1000);
  assert(!!hit && hit!.normal === null, 'inside start → t hit but null normal');
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
