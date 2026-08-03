import { rasterizeUvTexturePatch } from './uvTexturePatch';
import type { UvIslandRect } from './uvLayout';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) { try { fn(); passed += 1; log(`  ok  ${name}`); } catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); } }
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

const rect = (x: number, y: number, w: number, h: number, points: readonly [number, number, number, number, number, number]): UvIslandRect => ({
  x, y, w, h, group: 7,
  triangles: [{ face: 31, group: 7, points }],
});

test('a full-size patch bakes into the original master footprint without enlarging it', () => {
  const source = new Uint8Array(4 * 4 * 4);
  for (let at = 0; at < source.length; at += 4) {
    source[at] = 220; source[at + 1] = 40; source[at + 2] = 10; source[at + 3] = 255;
  }
  const master = rect(40, 70, 2, 2, [0, 0, 1, 0, 0, 1]);
  const local = rect(0, 0, 4, 4, [0, 0, 1, 0, 0, 1]);
  const raster = rasterizeUvTexturePatch(source, 4, 4, [master], [local]);
  assert(raster?.x === 40 && raster.y === 70, 'master origin changed');
  assert(raster?.width === 2 && raster.height === 2, 'local 4×4 edit leaked into the master scale');
  assert(raster?.rgba[3] === 255, 'covered master texel did not sample the patch');
});

test('patch-local placement selects source pixels while leaving outside-triangle pixels transparent', () => {
  const source = new Uint8Array([
    255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 255, 255, 255, 255,
  ]);
  const master = rect(10, 20, 2, 2, [0, 0, 1, 0, 0, 1]);
  const local = rect(0, 0, 1, 1, [0, 0, 1, 0, 0, 1]);
  const raster = rasterizeUvTexturePatch(source, 2, 2, [master], [local]);
  assert(Boolean(raster), 'valid patch did not rasterize');
  assert(raster!.rgba[3] === 255, 'inside triangle was transparent');
  assert(raster!.rgba[15] === 0, 'outside triangle overwrote an unrelated atlas texel');
});

test('render-face identity rejects incomplete or mismatched local mappings', () => {
  const source = new Uint8Array([255, 255, 255, 255]);
  const master = rect(0, 0, 1, 1, [0, 0, 1, 0, 0, 1]);
  const mismatch = { ...master, triangles: [{ ...master.triangles![0]!, face: 99 }] };
  assert(rasterizeUvTexturePatch(source, 1, 1, [master], [mismatch]) === null, 'mismatched face mapping was guessed');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed) throw new Error(`${failed} test(s) failed`);
