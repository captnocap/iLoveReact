// shaders/surfaceCompose.test.ts — meaning-tests for the surface-mode
// composer (Part 2: tile/span/layer). No GPU, no React — pure data-shape and
// D[] layout checks; visual correctness is verified by `rjit shot` on a real
// span/layer surface.
//
//   tools/esbuild cart/hmsc-int/render3d/shaders/surfaceCompose.test.ts --bundle \
//     --outfile=/tmp/surfaceCompose.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit=runtime
//   tools/v8cli /tmp/surfaceCompose.test.js

import { composeSurfaceShader, isComposite, surfaceSpecKey, type SurfaceSpec } from './surfaceCompose';
import { MATERIALS } from './_generated/registry';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(s + '\n'));
function test(name: string, fn: () => void) {
  try { fn(); passed++; log(`  ok  ${name}`); }
  catch (e) { failed++; log(`FAIL  ${name}: ${(e as Error).message}`); }
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }

const road = MATERIALS.find((m) => m.fn === 'road')!;
const sunset = MATERIALS.find((m) => m.fn === 'sunset_gradient')!;
const neonTube = MATERIALS.find((m) => m.fn === 'neon_tube')!;

test('a plain tile spec (no layers) is not composite', () => {
  const spec: SurfaceSpec = { base: { material: 'road', variant: 0, seed: 1 }, quality: 3, mode: 'tile', layers: [] };
  assert(!isComposite(spec), 'tile + zero layers must not need a generated shader');
});

test('span mode is always composite', () => {
  const spec: SurfaceSpec = { base: { material: 'sunset_gradient', variant: 0, seed: 1 }, quality: 3, mode: 'span', span: { id: 'wall-a', gx: 1, gy: 2, w: 4, h: 3 }, layers: [] };
  assert(isComposite(spec), 'span must be composite');
});

test('span without a span group throws — do not guess a default', () => {
  let threw = false;
  try {
    composeSurfaceShader({ base: { material: 'sunset_gradient', variant: 0, seed: 1 }, quality: 3, mode: 'span', layers: [] });
  } catch { threw = true; }
  assert(threw, 'mode span with no span group must throw');
});

test('unknown material name throws instead of silently resolving to nothing', () => {
  let threw = false;
  try {
    composeSurfaceShader({ base: { material: 'not-a-real-material', variant: 0, seed: 1 }, quality: 3, mode: 'tile', layers: [] });
  } catch { threw = true; }
  assert(threw, 'unknown base material must throw');
});

test('base-only composite (span, zero layers) produces a well-formed D[] and WGSL', () => {
  const spec: SurfaceSpec = {
    base: { material: 'sunset_gradient', variant: 1, seed: 7 },
    quality: 3, mode: 'span', span: { id: 'wall-a', gx: 2, gy: 0, w: 5, h: 1 }, layers: [],
  };
  const { wgsl, data } = composeSurfaceShader(spec);
  assert(data.length === 11, `base-only D[] should be exactly 11 floats, got ${data.length}`);
  assert(data[0] === sunset.materialId, 'D[0] is the base materialId');
  assert(data[1] === sunset.boardIndex, 'D[1] is the base board');
  assert(data[2] === 1 && data[3] === 7, 'D[2..3] carry variant/seed');
  assert(data[5] === 1, 'D[5] span flag set');
  assert(data[6] === 2 && data[9] === 1, 'D[6]=gx, D[9]=spanH');
  assert(wgsl.includes('fn sunset_gradient('), 'assembled shader includes the base material fn body');
  assert(wgsl.includes('fn fill_pick('), 'assembled shader includes the generated dispatcher');
  assert(wgsl.includes('spanFlag > 0.5'), 'fs_main branches on the span flag');
});

test('a base + 2 layers produces one D[] block per layer, in order', () => {
  const spec: SurfaceSpec = {
    base: { material: 'road', variant: 0, seed: 1 },
    quality: 3, mode: 'tile', layers: [
      { material: 'sunset_gradient', variant: 0, seed: 4, blend: 'add', factor: { kind: 'gradientY', value: 0.35 } },
      { material: 'neon_tube', variant: 1, seed: 9, blend: 'screen', factor: { kind: 'timePulse', value: 0.5 } },
    ],
  };
  const { wgsl, data } = composeSurfaceShader(spec);
  assert(data.length === 11 + 7 * 2, `expected 25 floats (11 base + 2x7 layers), got ${data.length}`);
  assert(data[10] === 2, 'D[10] is the layer count');
  assert(data[11] === sunset.materialId && data[12] === sunset.boardIndex, 'layer 0 material/board');
  assert(data[15] === 1, 'layer 0 blend code (add=1)');
  assert(data[16] === 1, 'layer 0 factor code (gradientY=1)');
  assert(data[17] === 0.35, 'layer 0 factor value');
  assert(data[18] === neonTube.materialId, 'layer 1 material');
  assert(data[22] === 3, 'layer 1 blend code (screen=3)');
  assert(data[23] === 3, 'layer 1 factor code (timePulse=3)');
  assert((wgsl.match(/fill_pick\(lm, lb, uv, px, lv, ls\)/g) ?? []).length === 2, 'two layer-eval call sites emitted');
  assert(wgsl.includes('fn road(') && wgsl.includes('fn sunset_gradient(') && wgsl.includes('fn neon_tube('), 'all three material bodies present, no duplication');
});

test('surfaceSpecKey differs for different span positions (must never collide)', () => {
  const base = { material: 'sunset_gradient', variant: 0, seed: 1 } as const;
  const a = surfaceSpecKey({ base, quality: 3, mode: 'span', span: { id: 'g', gx: 0, gy: 0, w: 4, h: 1 }, layers: [] });
  const b = surfaceSpecKey({ base, quality: 3, mode: 'span', span: { id: 'g', gx: 1, gy: 0, w: 4, h: 1 }, layers: [] });
  assert(a !== b, 'two different grid cells of the same span group must key differently');
});

test('surfaceSpecKey is stable for identical specs (cache correctness)', () => {
  const spec: SurfaceSpec = { base: { material: 'road', variant: 0, seed: 1 }, quality: 3, mode: 'tile', layers: [] };
  assert(surfaceSpecKey(spec) === surfaceSpecKey({ ...spec }), 'identical specs must produce identical keys');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0 && typeof (globalThis as any).__exit === 'function') (globalThis as any).__exit(1);
