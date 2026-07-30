import { parseUvIslandRects } from './uvLayout';
import { rasterizeUvWireframe, UV_WIREFRAME_EXPORT_TUNING } from './uvWireframe';

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
  assert(raster!.numberedFootprints === 0, 'transparent compositing guide gained generation labels');
});

test('generation UV guide adds a faint pink canvas and one number per exact footprint', () => {
  const rects = parseUvIslandRects(
    [2, 2, 12, 12, 2, 2, 12, 12, 18, 2, 10, 12],
    [700, 800, 900],
    [
      0, 700, 2, 2, 14, 2, 14, 14,
      0, 700, 2, 2, 14, 14, 2, 14,
      1, 800, 2, 2, 14, 2, 14, 14,
      1, 800, 2, 2, 14, 14, 2, 14,
      2, 900, 18, 2, 28, 2, 28, 14,
      2, 900, 18, 2, 28, 14, 18, 14,
    ],
  );
  const raster = rasterizeUvWireframe(rects, 32, 18, { kind: 'generation' });
  assert(Boolean(raster), 'valid UV geometry did not produce a generation guide');
  const [red, green, blue] = UV_WIREFRAME_EXPORT_TUNING.generationBackgroundRgb;
  assert(raster!.rgba[0] === red && raster!.rgba[1] === green && raster!.rgba[2] === blue, 'generation guide lost its pink canvas signal');
  assert(raster!.rgba[3] === UV_WIREFRAME_EXPORT_TUNING.generationBackgroundAlphaByte, 'generation guide pink signal was not 6% alpha');
  assert(raster!.numberedFootprints === 2, 'stacked logical islands received duplicate color-by-number labels');
  const [labelRed, labelGreen, labelBlue] = UV_WIREFRAME_EXPORT_TUNING.generationLabelBackgroundRgb;
  let foundLabel = false;
  for (let pixel = 0; pixel < raster!.rgba.length; pixel += 4) {
    if (raster!.rgba[pixel] === labelRed
      && raster!.rgba[pixel + 1] === labelGreen
      && raster!.rgba[pixel + 2] === labelBlue
      && raster!.rgba[pixel + 3] === UV_WIREFRAME_EXPORT_TUNING.generationLabelBackgroundAlphaByte) {
      foundLabel = true;
      break;
    }
  }
  assert(foundLabel, 'generation guide did not rasterize a readable number plate');
});

test('wireframe export rejects unbounded allocations and empty geometry', () => {
  assert(rasterizeUvWireframe([], 16, 16) === null, 'empty geometry emitted a blank file');
  assert(rasterizeUvWireframe([], 100_000, 100_000) === null, 'oversized raster allocation was admitted');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed) throw new Error(`${failed} test(s) failed`);
