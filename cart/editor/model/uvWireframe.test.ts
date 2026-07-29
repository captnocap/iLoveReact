import { parseUvIslandRects } from './uvLayout';
import { rasterizeUvWireframe } from './uvWireframe';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) { try { fn(); passed += 1; log(`  ok  ${name}`); } catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); } }
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

const alphaAt = (rgba: Uint8Array, width: number, x: number, y: number): number => rgba[(y * width + x) * 4 + 3]!;

test('transparent UV wireframe preserves authored quad edges without its resident diagonal', () => {
  const rects = parseUvIslandRects(
    [2, 2, 12, 12],
    [700],
    [
      0, 700, 2, 2, 14, 2, 14, 14,
      0, 700, 2, 2, 14, 14, 2, 14,
    ],
  );
  const raster = rasterizeUvWireframe(rects, 16, 16);
  assert(Boolean(raster), 'valid UV geometry did not produce a raster');
  assert(raster!.authoredEdges === 4 && raster!.boundaryEdges === 4, 'quad export reintroduced its triangle diagonal');
  assert(alphaAt(raster!.rgba, 16, 8, 2) > 0, 'authored top edge was transparent');
  assert(alphaAt(raster!.rgba, 16, 8, 8) === 0, 'quad diagonal painted across the transparent centre');
  assert(alphaAt(raster!.rgba, 16, 0, 0) === 0, 'transparent background received an opaque fill');
});

test('wireframe export rejects unbounded allocations and empty geometry', () => {
  assert(rasterizeUvWireframe([], 16, 16) === null, 'empty geometry emitted a blank file');
  assert(rasterizeUvWireframe([], 100_000, 100_000) === null, 'oversized raster allocation was admitted');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed) throw new Error(`${failed} test(s) failed`);
