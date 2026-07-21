import {
  EMPTY_MODEL_HISTORY,
  UV_ATLAS_IMPORT_LABEL,
  UV_ATLAS_RELOAD_LABEL,
  UV_HISTORY_ACTIONS,
  isUvDocumentHistoryLabel,
  parseModelHistory,
  uvHistoryActionOrdinal,
} from './uvHistory';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) { try { fn(); passed += 1; log(`  ok  ${name}`); } catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); } }
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

test('every UV mutation has one stable append-only host ordinal', () => {
  assert(UV_HISTORY_ACTIONS.length === 13, `expected 13 UV actions, got ${UV_HISTORY_ACTIONS.length}`);
  UV_HISTORY_ACTIONS.forEach((row, ordinal) => {
    assert(uvHistoryActionOrdinal(row.id) === ordinal, `${row.id} drifted from ordinal ${ordinal}`);
    assert(isUvDocumentHistoryLabel(row.label), `${row.label} is not admitted by the UV history gate`);
  });
});

test('atlas replacement actions share the UV document-history gate', () => {
  assert(isUvDocumentHistoryLabel(UV_ATLAS_IMPORT_LABEL), 'texture import cannot be undone from the UV panel');
  assert(isUvDocumentHistoryLabel(UV_ATLAS_RELOAD_LABEL), 'texture reload cannot be undone from the UV panel');
  assert(!isUvDocumentHistoryLabel('delete part'), 'UV history would bypass outliner resynchronization');
});

test('native history parsing keeps depths and top labels honest', () => {
  const parsed = parseModelHistory('{"undo":4,"redo":2,"undoLabel":"move UV islands","redoLabel":"rotate UV"}');
  assert(parsed.undo === 4 && parsed.redo === 2, 'journal depths drifted');
  assert(parsed.undoLabel === 'move UV islands' && parsed.redoLabel === 'rotate UV', 'top labels drifted');
  const clamped = parseModelHistory('{"undo":-8,"redo":2.9}');
  assert(clamped.undo === 0 && clamped.redo === 2, 'malformed depths escaped normalization');
  assert(parseModelHistory('not json') === EMPTY_MODEL_HISTORY, 'malformed history did not use the stable empty state');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) (globalThis as any).__exit?.(1);
