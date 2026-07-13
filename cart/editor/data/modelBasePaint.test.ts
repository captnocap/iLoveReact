import { parseModelBasePaintText } from './modelPackageStore';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) { try { fn(); passed += 1; log(`  ok  ${name}`); } catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); } }
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

test('base paint restores the durable stroke program and density', () => {
  const paint = parseModelBasePaintText(JSON.stringify({ version: 1, detail: 64, program: 'c3Ryb2tlcw==' }));
  assert(paint?.detail === 64 && paint.program === 'c3Ryb2tlcw==', 'valid base paint was not restored');
});

test('base paint refuses empty or unknown records', () => {
  assert(parseModelBasePaintText('{"version":2,"detail":64,"program":"x"}') === null, 'unknown version was accepted');
  assert(parseModelBasePaintText('{"version":1,"detail":64,"program":""}') === null, 'empty program was accepted');
  assert(parseModelBasePaintText('broken') === null, 'malformed json was accepted');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed) throw new Error(`${failed} test(s) failed`);
