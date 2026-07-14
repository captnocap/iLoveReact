// cart/editor/world/facades.test.ts — the graffiti facade contract (req_3057):
// gatherFacade collects exactly the coplanar contiguous wall run, the canvas is
// meter-true at the RULED 256 px/m, the baked quad lands on the wall plane, and
// stamps blit with free rotation + die-cut transparency.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/world/facades.test.ts --bundle \
//     --outfile=/tmp/editor-facades.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit/runtime=$ROOT/runtime \
//     --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-facades.test.js

import { gatherFacade, facadeCanvasSize, facadeQuadMesh, validFacade, FACADE_TEXELS_PER_METER, FACADE_LIFT_METERS } from './facades';
import { decodePackedTexture, blitStampInto } from './facadeBake';
import { pieceLook, type PlacedPiece } from './pieces';
import { registerStickers } from '../data/stickerStore';
import { registerImportedSpecs } from '../textures/shaders';

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

const WALL = 'wall.brick.downtown';
const look = pieceLook(WALL)!;
const W = look.w, H = look.h;
const wall = (id: string, x: number, z: number, yaw = 0, y = 0): PlacedPiece =>
  ({ id, pieceId: WALL, x, y, z, yawDegrees: yaw });

test('gather collects the contiguous coplanar run and nothing else', () => {
  const run = [wall('a', 0, 5), wall('b', W, 5), wall('c', W * 2, 5)];
  const detached = wall('far', W * 6, 5);
  const perpendicular = wall('perp', 0, 8, 90);
  const f = gatherFacade(run[1]!, [...run, detached, perpendicular], 'f1');
  assert(!!f, 'facade gathers');
  assert(f!.pieceIds.length === 3, `3 members, got ${f!.pieceIds.length}`);
  assert(!f!.pieceIds.includes('far') && !f!.pieceIds.includes('perp'), 'detached + perpendicular excluded');
  near(f!.widthMeters, W * 3, 'width spans the run');
  near(f!.heightMeters, H, 'height is one storey');
});

test('a second storey extends the canvas upward (contiguous in v)', () => {
  const f = gatherFacade(wall('a', 0, 5), [wall('a', 0, 5), wall('up', 0, 5, 0, H)], 'f2');
  assert(!!f && f!.pieceIds.length === 2, 'both storeys gather');
  near(f!.heightMeters, H * 2, 'two storeys tall');
});

test('a 180-yaw piece in the same plane joins the run', () => {
  const f = gatherFacade(wall('a', 0, 5), [wall('a', 0, 5), wall('flip', W, 5, 180)], 'f3');
  assert(!!f && f!.pieceIds.length === 2, '180 sibling joins');
});

test('canvas size = meters x the RULED density; quad floats off the plane', () => {
  const f = gatherFacade(wall('a', 0, 5), [wall('a', 0, 5)], 'f4')!;
  const size = facadeCanvasSize(f);
  near(size.w, Math.round(W * FACADE_TEXELS_PER_METER), 'canvas w');
  near(size.h, Math.round(H * FACADE_TEXELS_PER_METER), 'canvas h');
  const mesh = facadeQuadMesh(f);
  assert(mesh.length === 12 * 8, 'two-sided quad, 12 verts');
  // yaw-0 wall: plane z = 5, normal +z → every vert sits at z = 5 + lift.
  for (let v = 0; v < 12; v += 1) near(mesh[v * 8 + 2]!, 5 + FACADE_LIFT_METERS, `vert ${v} on the lifted plane`);
  assert(validFacade(f), 'round-trips the validator');
});

// ── stamp blitting ────────────────────────────────────────────────────────────

registerStickers([{ version: 1, id: 'stk-t', name: 't', textureId: 'img-t', widthMeters: 1, heightMeters: 1 }]);
registerImportedSpecs([{
  id: 'img-t', label: 't', group: 'Imported', blurb: '', shader: 'S', base: [],
  variants: [{ id: 'v0', label: 'Source', value: 0, params: [] }],
  // 2x2 palette texture: red / transparent / transparent / red (diagonal).
  buildData: () => [2, 2, 1, 1, 0, 0, /*cells*/ 0, -1, -1, 0],
  slots: [],
} as any]);

test('decodePackedTexture — palette mode with die-cut transparency', () => {
  const img = decodePackedTexture([2, 2, 1, 1, 0, 0, 0, -1, -1, 0]);
  assert(img.w === 2 && img.h === 2, 'dims');
  assert(img.rgba[0] === 255 && img.rgba[3] === 255, 'cell 0 red opaque');
  assert(img.rgba[7] === 0, 'cell 1 transparent');
});

test('a stamp lands centered, transparent cells never write', () => {
  // 4m x 4m facade canvas; 1m sticker at center (u=2, v=2), no rotation.
  const cw = 4 * FACADE_TEXELS_PER_METER, ch = 4 * FACADE_TEXELS_PER_METER;
  const canvas = new Uint8Array(cw * ch * 4);
  blitStampInto(canvas, cw, ch, { stickerId: 'stk-t', u: 2, v: 2, scale: 1, rotDegrees: 0 }, 4);
  const at = (xM: number, vM: number) => {
    const x = Math.floor(xM * FACADE_TEXELS_PER_METER);
    const y = Math.floor((4 - vM) * FACADE_TEXELS_PER_METER);
    return (y * cw + x) * 4;
  };
  // top-left quadrant of the sticker = palette cell 0 (red, opaque).
  assert(canvas[at(1.75, 2.25) + 3] === 255, 'opaque cell painted');
  // top-right quadrant = transparent cell — canvas stays untouched.
  assert(canvas[at(2.25, 2.25) + 3] === 0, 'die-cut cell skipped');
  // outside the stamp entirely.
  assert(canvas[at(0.5, 0.5) + 3] === 0, 'far texel untouched');
});

test('free rotation — 90° swaps the diagonal', () => {
  const cw = 2 * FACADE_TEXELS_PER_METER, ch = 2 * FACADE_TEXELS_PER_METER;
  const a = new Uint8Array(cw * ch * 4);
  const b = new Uint8Array(cw * ch * 4);
  blitStampInto(a, cw, ch, { stickerId: 'stk-t', u: 1, v: 1, scale: 1, rotDegrees: 0 }, 2);
  blitStampInto(b, cw, ch, { stickerId: 'stk-t', u: 1, v: 1, scale: 1, rotDegrees: 90 }, 2);
  const at = (xM: number, vM: number) => (Math.floor((2 - vM) * FACADE_TEXELS_PER_METER) * cw + Math.floor(xM * FACADE_TEXELS_PER_METER)) * 4;
  // Unrotated: top-left opaque. Rotated 90: that corner's paint moved.
  const corner = at(0.75, 1.25) + 3;
  assert(a[corner] === 255, 'unrotated corner painted');
  assert(b[corner] === 0, 'rotated corner now the transparent cell');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
