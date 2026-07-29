// cart/editor/data/paintAtlasCompiler.test.ts — pure lossless planning/remap tests.
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/data/paintAtlasCompiler.test.ts --bundle \
//     --outfile=/tmp/editor-paint-atlas-compiler.test.js --format=iife \
//     --platform=neutral --target=es2022 \
//     --alias:@reactjit/runtime=$ROOT/runtime --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-paint-atlas-compiler.test.js
import {
  PAINT_ATLAS_COMPILE_TUNING,
  blitPaintAtlasTile,
  planPaintAtlas,
  remapPaintAtlasMesh,
} from './paintAtlasCompiler';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }
function close(actual: number, expected: number, message: string) {
  if (Math.abs(actual - expected) > 1e-6) throw new Error(`${message}: ${actual} != ${expected}`);
}

function triangle(minU: number, minV: number, maxU: number, maxV: number): Float32Array {
  return new Float32Array([
    10, 11, 12, 20, 21, 22, minU, minV,
    30, 31, 32, 40, 41, 42, maxU, minV,
    50, 51, 52, 60, 61, 62, minU, maxV,
  ]);
}

function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w
    && a.y < b.y + b.h && b.y < a.y + a.h;
}

test('best-fit planning is deterministic and never overlaps assigned look rectangles', () => {
  const inputs = [
    { key: 'base', width: 256, height: 256, pngHash: 'a'.repeat(64), vertices: triangle(0.1, 0.1, 0.45, 0.7) },
    { key: 'variant:1', width: 256, height: 256, pngHash: 'b'.repeat(64), vertices: triangle(0.2, 0.2, 0.8, 0.42) },
    { key: 'variant:2', width: 128, height: 256, pngHash: 'c'.repeat(64), vertices: triangle(0.1, 0.1, 0.7, 0.7) },
  ];
  const first = planPaintAtlas(inputs);
  const second = planPaintAtlas(inputs);
  assert(JSON.stringify(first) === JSON.stringify(second), 'same sources produced a different packing');
  assert(first.width <= PAINT_ATLAS_COMPILE_TUNING.maxDimension, 'atlas width escaped the texture cap');
  assert(first.height <= PAINT_ATLAS_COMPILE_TUNING.maxDimension, 'atlas height escaped the texture cap');
  for (let a = 0; a < first.tiles.length; a += 1) {
    for (let b = a + 1; b < first.tiles.length; b += 1) {
      assert(!overlaps(first.tiles[a]!.packedRect, first.tiles[b]!.packedRect), 'packed look rectangles overlap');
    }
  }
});

test('byte-identical base and variant sources reuse one atlas tile', () => {
  const vertices = triangle(0.15, 0.2, 0.75, 0.8);
  const plan = planPaintAtlas([
    { key: 'base', width: 128, height: 64, pngHash: 'd'.repeat(64), vertices },
    { key: 'variant:1', width: 128, height: 64, pngHash: 'd'.repeat(64), vertices },
  ]);
  assert(plan.sources.length === 2, 'one logical look disappeared');
  assert(plan.tiles.length === 1, 'identical raster/crop was duplicated in the shared atlas');
  assert(plan.sources[0]!.atlasRect.x === plan.sources[1]!.atlasRect.x
    && plan.sources[0]!.atlasRect.y === plan.sources[1]!.atlasRect.y, 'aliased looks received different locations');
});

test('tile copy preserves covered RGBA exactly and extrudes its own edge into padding', () => {
  const sourceWidth = 8, sourceHeight = 6;
  const source = new Uint8Array(sourceWidth * sourceHeight * 4);
  for (let y = 0; y < sourceHeight; y += 1) {
    for (let x = 0; x < sourceWidth; x += 1) {
      const at = (y * sourceWidth + x) * 4;
      source[at + 0] = x * 17;
      source[at + 1] = y * 29;
      source[at + 2] = x + y;
      source[at + 3] = 40 + x * 3 + y; // authored alpha must survive
    }
  }
  const atlasWidth = 12, atlasHeight = 8;
  const atlas = new Uint8Array(atlasWidth * atlasHeight * 4);
  const tile = {
    key: 'tile',
    sourceKey: 'base',
    sourceRect: { x: 2, y: 1, w: 3, h: 2 },
    atlasRect: { x: 4, y: 3, w: 3, h: 2 },
    packedRect: { x: 2, y: 1, w: 7, h: 6 },
  };
  blitPaintAtlasTile(atlas, atlasWidth, atlasHeight, tile, source, sourceWidth, sourceHeight);
  for (let y = 0; y < tile.sourceRect.h; y += 1) {
    for (let x = 0; x < tile.sourceRect.w; x += 1) {
      const read = ((tile.sourceRect.y + y) * sourceWidth + tile.sourceRect.x + x) * 4;
      const write = ((tile.atlasRect.y + y) * atlasWidth + tile.atlasRect.x + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        assert(atlas[write + channel] === source[read + channel], `RGBA channel ${channel} changed during tile copy`);
      }
    }
  }
  const edge = (tile.sourceRect.y * sourceWidth + tile.sourceRect.x) * 4;
  const extruded = ((tile.atlasRect.y - 2) * atlasWidth + tile.atlasRect.x - 2) * 4;
  for (let channel = 0; channel < 4; channel += 1) {
    assert(atlas[extruded + channel] === source[edge + channel], 'tile padding sampled a neighbour instead of its own edge');
  }
});

test('mesh compile changes only UVs and maps source texels to the assigned atlas rectangle', () => {
  const source = triangle(2 / 8, 1 / 6, 4 / 8, 2 / 6);
  const out = remapPaintAtlasMesh(
    source,
    8,
    6,
    { x: 2, y: 1, w: 3, h: 2 },
    { x: 4, y: 3, w: 3, h: 2 },
    12,
    8,
  );
  for (let vertex = 0; vertex < source.length; vertex += 8) {
    for (let field = 0; field < 6; field += 1) {
      close(out[vertex + field]!, source[vertex + field]!, `geometry field ${field} changed`);
    }
  }
  close(out[6]!, 4 / 12, 'source crop origin did not map to atlas assignment x');
  close(out[7]!, 3 / 8, 'source crop origin did not map to atlas assignment y');
  close(out[8 + 6]!, 6 / 12, 'source max x did not retain its texel distance');
  close(out[2 * 8 + 7]!, 4 / 8, 'source max y did not retain its texel distance');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
