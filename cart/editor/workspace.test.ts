import './workspace.cls';
import { getClassifier } from '../../runtime/classifier';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) { try { fn(); passed += 1; log(`  ok  ${name}`); } catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); } }
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

test('fixed-height context actions can never grow by wrapping their labels', () => {
  const row = getClassifier('HW_ContextRow')?.__def;
  const label = getClassifier('HW_ContextText')?.__def;
  assert(row?.style?.height === 26, 'context action row height contract drifted');
  assert(label?.noWrap === true && label?.numberOfLines === 1, 'context action label can wrap');
  assert(label?.style?.flexShrink === 1 && label?.style?.minWidth === 0, 'context action label cannot yield to its key hint');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed) throw new Error(`${failed} test(s) failed`);
