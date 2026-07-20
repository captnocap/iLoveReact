// cart/editor/world/facades.test.ts — the graffiti facade contract (req_3057):
// Explicit selection defines the facade scope, the canvas is meter-true at the
// RULED 256 px/m, the baked quad lands on the clicked wall face, and stamps
// blit with free rotation + die-cut transparency.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/world/facades.test.ts --bundle \
//     --outfile=/tmp/editor-facades.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit/runtime=$ROOT/runtime \
//     --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-facades.test.js

import { facadeFromSelection, facadeLayers, facadeCanvasSize, facadeQuadMesh, validFacade, FACADE_TEXELS_PER_METER, FACADE_LIFT_METERS } from './facades';
import { compositeFacadeStrokeMask, decodePackedTexture, blitStampInto, resizeFacadeRgba } from './facadeBake';
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

test('a one-piece selection never gathers its contiguous wall run', () => {
  const run = [wall('a', 0, 5), wall('b', W, 5), wall('c', W * 2, 5)];
  const f = facadeFromSelection([run[1]!], 'one-piece');
  assert(!!f, 'one selected wall creates a facade');
  assert(f!.pieceIds.length === 1 && f!.pieceIds[0] === 'b', 'only the selected wall is in scope');
  near(f!.widthMeters, W, 'canvas width is exactly one wall');
  near(f!.heightMeters, H, 'canvas height is exactly one wall');
});

test('explicit selection is exact scope, even across an unselected middle wall', () => {
  const a = wall('a', 0, 5), middle = wall('middle', W, 5), c = wall('c', W * 2, 5);
  const f = facadeFromSelection([a, c], 'selected');
  assert(!!f, 'selected coplanar walls merge');
  assert(f!.pieceIds.length === 2 && !f!.pieceIds.includes(middle.id), 'unselected middle wall stayed out of scope');
  near(f!.widthMeters, W * 3, 'union rect spans the selected mural bounds');
  assert(facadeFromSelection([a, wall('perp', 0, 8, 90)], 'bad') === null, 'non-coplanar selection rejected');
});

test('canvas size = meters x the RULED density; quad floats off the plane', () => {
  const f = facadeFromSelection([wall('a', 0, 5)], 'f4')!;
  const size = facadeCanvasSize(f);
  near(size.w, Math.round(W * FACADE_TEXELS_PER_METER), 'canvas w');
  near(size.h, Math.round(H * FACADE_TEXELS_PER_METER), 'canvas h');
  const mesh = facadeQuadMesh(f);
  assert(mesh.length === 12 * 8, 'two-sided quad, 12 verts');
  // yaw-0 wall: plane z = 5, normal +z → every vert sits at z = 5 + lift.
  for (let v = 0; v < 12; v += 1) near(mesh[v * 8 + 2]!, 5 + FACADE_LIFT_METERS, `vert ${v} on the lifted plane`);
  assert(validFacade(f), 'round-trips the validator');
});

test('front stays byte-for-byte anchored while back mirrors to the clicked face', () => {
  const piece = wall('a', 0, 5);
  const front = facadeFromSelection([piece], 'front-facade', 'front')!;
  const back = facadeFromSelection([piece], 'back-facade', 'back')!;
  // Lock the established front contract so adding clicked-side selection cannot
  // move the façade that existing saves and tests expect.
  near(front.normal.x, 0, 'front normal x');
  near(front.normal.z, 1, 'front normal z');
  near(front.origin.x, -W / 2, 'front origin x');
  near(front.origin.z, 5, 'front origin z');
  near(back.normal.x, 0, 'back normal x');
  near(back.normal.z, -1, 'back normal z');
  near(back.origin.x, W / 2, 'back origin mirrors u origin');
  near(back.origin.z, 5, 'back origin remains on the wall plane');
  near(back.widthMeters, front.widthMeters, 'back preserves wall width');
  near(back.heightMeters, front.heightMeters, 'back preserves wall height');
  const frontMesh = facadeQuadMesh(front);
  const backMesh = facadeQuadMesh(back);
  for (let v = 0; v < 12; v += 1) {
    near(frontMesh[v * 8 + 2]!, 5 + FACADE_LIFT_METERS, `front vert ${v} lifted outward`);
    near(backMesh[v * 8 + 2]!, 5 - FACADE_LIFT_METERS, `back vert ${v} lifted outward`);
  }
});

test('full studio stroke recipe + layers round-trip; legacy spray rows migrate', () => {
  const f = facadeFromSelection([wall('a', 0, 5)], 'recipe')!;
  f.layers[0]!.strokes.push({
    ink: { kind: 'shader', surface: 'brick', data: [1, 2, 3], tiles: 2 },
    brush: { stamp: { kind: 'analytic', shape: 'spray' }, sizeMeters: 0.2, hardness: 0.5, flow: 0.8, scatter: 1.2, angleDeg: 12, aspect: 1.5, spacing: 0.25, blend: 'normal' },
    tool: 'brush', points: [0, 0, 1, 1], selection: { kind: 'lasso', points: [0, 0, 1, 0, 1, 1] },
  });
  assert(validFacade(f), 'full recipe validates');
  const stroke = f.layers[0]!.strokes[0]!;
  const invalid = { ...f, layers: [{ ...f.layers[0]!, strokes: [{ ...stroke, brush: { ...stroke.brush, blend: 'surprise-mode' } }] }] };
  assert(!validFacade(invalid), 'boundary rejects a non-canonical brush recipe');
  const legacy = { ...f, layers: undefined, activeLayerId: undefined, strokes: [{ hex: '#ff0000', radiusMeters: 0.1, points: [0, 0, 1, 1] }] };
  assert(validFacade(legacy), 'legacy row remains loadable');
  const migrated = facadeLayers(legacy as any);
  assert(migrated.length === 1 && migrated[0]!.strokes[0]!.brush.sizeMeters === 0.2, 'legacy radius became a meter-space diameter recipe');
});

test('host brush mask composites shader pixels through an exact lasso', () => {
  const base = new Uint8Array(4 * 4 * 4);
  const mask = new Uint8Array(4 * 4 * 4);
  for (let i = 3; i < mask.length; i += 4) mask[i] = 255;
  const shader = { width: 1, height: 1, rgba: new Uint8Array([12, 34, 56, 255]) };
  compositeFacadeStrokeMask(base, mask, 4, 4, { kind: 'shader', surface: 's' }, false, { kind: 'lasso', points: [0, 0, 2, 0, 0, 2] }, shader);
  const alpha = (x: number, y: number) => base[(y * 4 + x) * 4 + 3];
  assert(alpha(0, 0) === 255, 'inside lasso received shader ink');
  assert(alpha(3, 3) === 0, 'outside lasso stayed transparent');
  const resized = resizeFacadeRgba(base, 4, 4, 2, 2);
  assert(resized.length === 16, 'preview density resizes to ambient bake dimensions');
});

test('facade replay honors blend and erase recipes', () => {
  const mask = new Uint8Array([0, 0, 0, 255]);
  const multiply = new Uint8Array([128, 128, 128, 255]);
  compositeFacadeStrokeMask(multiply, mask, 1, 1, { kind: 'color', hex: '#808080' }, false, undefined, null, 'multiply');
  assert(multiply[0] >= 63 && multiply[0] <= 65, `multiply produced ${multiply[0]}`);
  const screen = new Uint8Array([128, 128, 128, 255]);
  compositeFacadeStrokeMask(screen, mask, 1, 1, { kind: 'color', hex: '#808080' }, false, undefined, null, 'screen');
  assert(screen[0] >= 191 && screen[0] <= 193, `screen produced ${screen[0]}`);
  compositeFacadeStrokeMask(screen, mask, 1, 1, { kind: 'color', hex: '#ffffff' }, false, undefined, null, 'erase');
  assert(screen[3] === 0, 'erase blend did not reveal the layer below');
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
