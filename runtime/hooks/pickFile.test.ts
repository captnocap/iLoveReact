import { parsePickedFiles } from './pickFile';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) { try { fn(); passed += 1; log(`  ok  ${name}`); } catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); } }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

test('multi-file picker output preserves spaces and drops only empty separator rows', () => {
  const paths = parsePickedFiles('/textures/front tire.png\n/textures/ tail light .webp\n');
  assert(paths.length === 2, 'picker rows were not split');
  assert(paths[1] === '/textures/ tail light .webp', 'legal filename spaces were trimmed');
});

test('multi-file picker accepts CRLF output', () => {
  const paths = parsePickedFiles('/a.png\r\n/b.jpg\r\n');
  assert(paths.length === 2 && paths[1] === '/b.jpg', 'CRLF picker rows were not parsed');
});

log(`${failed === 0 ? 'PASS' : 'FAIL'} multi-file picker: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} multi-file picker test(s) failed`);
