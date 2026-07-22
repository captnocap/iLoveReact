// Native game-map wire boundary tests.
//
//   tools/esbuild runtime/game/map.test.ts --bundle \
//     --outfile=/tmp/runtime-game-map.test.js --format=iife --platform=neutral --target=es2022
//   tools/v8cli /tmp/runtime-game-map.test.js
import { decodeMapPathSnapshot } from './map';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((text: string) => (globalThis as any).__writeStdout?.(`${text}\n`));
function test(name: string, run: () => void) {
  try { run(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

test('path snapshot decodes road and rail recipes in world metres', () => {
  const decoded = decodeMapPathSnapshot(new Float32Array([
    1, 2,
    7, 0, 2, 1, 1, 0, 10, 50, 2,
    -60, 120, 0, 2940, 120, 0,
    8, 1, 0, 0, 0, 2, 18, 0, 3,
    10, 20, 0, 30, 40, 3, 50, 60, 6,
  ]));
  assert(decoded?.paths.length === 2, 'path count was not decoded');
  assert(decoded?.paths[0]?.kind === 'road' && decoded.paths[0].profile.lanesF === 2 && decoded.paths[0].profile.sidewalks, 'road profile drifted');
  assert(decoded?.paths[0]?.points[0]?.x === -60 && decoded.paths[0].points[1]?.x === 2940, 'world coordinates drifted');
  assert(decoded?.paths[1]?.kind === 'lightRail' && decoded.paths[1].profile.tracks === 2 && decoded.paths[1].points[2]?.elevationM === 6, 'rail recipe drifted');
});

test('path snapshot rejects partial or ambiguous buffers', () => {
  const valid = [1, 1, 1, 0, 1, 1, 0, 0, 8, 30, 2, 0, 0, 0, 10, 10, 0];
  assert(decodeMapPathSnapshot(new Float32Array(valid)) !== null, 'valid minimal path was rejected');
  assert(decodeMapPathSnapshot(new Float32Array(valid.slice(0, -1))) === null, 'truncated point was accepted');
  assert(decodeMapPathSnapshot(new Float32Array([...valid, 99])) === null, 'trailing data was accepted');
  assert(decodeMapPathSnapshot(new Float32Array([2, 0])) === null, 'unknown version was accepted');
  const invalidKind = [...valid]; invalidKind[3] = 9;
  assert(decodeMapPathSnapshot(new Float32Array(invalidKind)) === null, 'unknown path kind was accepted');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
