import {
  EMPTY_MODEL_HISTORY,
  UV_ATLAS_IMPORT_LABEL,
  UV_ATLAS_RELOAD_LABEL,
  UV_HISTORY_ACTIONS,
  isUvDocumentHistoryLabel,
  parsePaintHistory,
  parseModelHistory,
  uvHistoryAvailability,
  uvHistoryActionOrdinal,
} from './uvHistory';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) { try { fn(); passed += 1; log(`  ok  ${name}`); } catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); } }
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

test('every UV mutation has one stable append-only host ordinal', () => {
  assert(UV_HISTORY_ACTIONS.length === 20, `expected 20 UV actions, got ${UV_HISTORY_ACTIONS.length}`);
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

test('paint history normalizes its older label field for chronology barriers', () => {
  const parsed = parsePaintHistory('{"undo":3,"redo":1,"label":"stroke","redoLabel":"delete layer"}');
  assert(parsed.undo === 3 && parsed.redo === 1, 'paint journal depths drifted');
  assert(parsed.undoLabel === 'stroke' && parsed.redoLabel === 'delete layer', 'paint top labels drifted');
  assert(parsePaintHistory(null) === EMPTY_MODEL_HISTORY, 'missing paint history did not stay honest-empty');
});

test('paint steps ahead of UV history block out-of-order document restores', () => {
  const model = parseModelHistory('{"undo":2,"redo":1,"undoLabel":"move UV islands","redoLabel":"rotate UV"}');
  assert(uvHistoryAvailability(model, EMPTY_MODEL_HISTORY).undo, 'clean UV undo was blocked');
  assert(uvHistoryAvailability(model, EMPTY_MODEL_HISTORY).redo, 'clean UV redo was blocked');
  const newerPaint = parsePaintHistory('{"undo":1,"redo":0,"label":"stroke"}');
  assert(!uvHistoryAvailability(model, newerPaint).undo, 'UV undo could overwrite a newer stroke');
  const earlierUndonePaint = parsePaintHistory('{"undo":0,"redo":1,"redoLabel":"stroke"}');
  assert(!uvHistoryAvailability(model, earlierUndonePaint).redo, 'UV redo could skip an earlier paint redo');
  const meshTop = parseModelHistory('{"undo":1,"redo":0,"undoLabel":"delete part"}');
  assert(!uvHistoryAvailability(meshTop, EMPTY_MODEL_HISTORY).undo, 'UV panel could bypass a newer mesh edit');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) (globalThis as any).__exit?.(1);
