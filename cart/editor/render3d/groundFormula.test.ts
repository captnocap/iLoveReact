import { EDITOR_GROUND_FORMULA, tileBindingFor } from './groundFormula';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

test('every directional road lane resolves to asphalt instead of the concrete fallback', () => {
  for (const kind of ['laneNorth', 'laneSouth', 'laneEast', 'laneWest'] as const) {
    assert(tileBindingFor(kind).fn === 'asphalt', `${kind} is not asphalt`);
  }
  assert(tileBindingFor('junction').fn === 'asphalt', 'junction is not asphalt');
  assert(tileBindingFor('median').fn === 'asphalt', 'median is not asphalt');
});

test('ground shader rotates catalog UVs for east-west road grammar', () => {
  assert(EDITOR_GROUND_FORMULA.includes('var roadAlongX = kind =='), 'directional road dispatch missing');
  assert(EDITOR_GROUND_FORMULA.includes('surfaceUv = vec2f(fc.y, fc.x)'), 'east-west UV swap missing');
  assert(EDITOR_GROUND_FORMULA.includes('immediately adjacent directional lane cells'), 'median axis inference missing');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} test(s) failed`);
