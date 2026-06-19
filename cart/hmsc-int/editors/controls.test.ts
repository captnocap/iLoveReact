// controls.test.ts — P4 behavior tests for the editor control contract
// (EDITORCTL-0610, structure review §3). The contract under test: the table
// is the bindings; conflicts are boot-time errors; chord matching excludes
// stray modifiers; the typing gate holds on press and never swallows a
// release; the legend is derived from the same rows that dispatch.

import {
  EDITOR_BINDINGS, validateEditorBindings, bindingsForScope, legendForScope,
  chordOf, resolveEditorKey, setUserBinding, clearUserBinding, isOverridden,
  loadUserBindings, exportUserBindings, prettyChord, setKeyCapture, type EditorBinding,
} from './controls';
import { assert, assertEqual, assertThrows, finish, test } from '../game/_testkit';

const bind = (over: Partial<EditorBinding>): EditorBinding => ({
  action: 'test.verb', scope: 'canvas', keys: ['x'], label: 't', legend: null, ...over,
});

test('the live table validates: registration is where conflicts die', () => {
  validateEditorBindings(EDITOR_BINDINGS); // the real table must hold its own law
  assertThrows(
    () => validateEditorBindings([bind({ action: 'a.one', keys: ['e'] }), bind({ action: 'a.two', keys: ['e'] })]),
    'two actions on one chord in one scope must throw',
  );
  // the same chord in DIFFERENT scopes is the design (E orbits iso, E rotates canvas)
  validateEditorBindings([bind({ action: 'a.one', keys: ['e'] }), bind({ action: 'a.two', scope: 'iso-build', keys: ['e'] })]);
  assertThrows(() => validateEditorBindings([bind({ action: 'NotKebab' })]), 'action ids are <concern>.<verb> kebab-case');
  assertThrows(() => validateEditorBindings([bind({ keys: [] })]), 'a binding with no keys is incomplete');
  assertThrows(() => validateEditorBindings([bind({ keys: ['shift+ctrl+z'] })]), 'modifiers must be in canonical order');
});

test('chord normalization: modifiers in canonical order, case-folded', () => {
  assertEqual(chordOf({ key: 'E' }), 'e', 'bare keys fold to lowercase');
  assertEqual(chordOf({ key: 'Z', ctrlKey: true, shiftKey: true }), 'ctrl+shift+z', 'modifier order is canonical');
  assertEqual(chordOf({ key: 'F8' }), 'f8', 'function keys pass through');
});

test('press resolution: exact chord, stray modifiers excluded, scope-local', () => {
  const hit = resolveEditorKey('iso-build', 'down', { key: 'e' }, false);
  assertEqual(hit?.action, 'camera.orbit-cw', 'bare E orbits in the iso scope');
  assertEqual(resolveEditorKey('canvas', 'down', { key: 'e' }, false)?.action, 'brush.rotate-cw', 'the same key means its own thing per scope');
  assertEqual(resolveEditorKey('iso-build', 'down', { key: 'e', ctrlKey: true }, false), null, 'ctrl+E is NOT E — stray modifiers never fire bare bindings');
  assertEqual(resolveEditorKey('bench', 'down', { key: 'z', ctrlKey: true }, false)?.action, 'bench.undo', 'combos resolve');
  assertEqual(resolveEditorKey('bench', 'down', { key: 'z', ctrlKey: true, shiftKey: true }, false)?.action, 'bench.redo', 'ctrl+shift+z is redo, not undo');
});

test('the typing gate: holds on press, never on release, whileTyping opts out', () => {
  assertEqual(resolveEditorKey('iso-build', 'down', { key: 'r' }, true), null, 'plain keys never fire into a focused text field');
  assertEqual(resolveEditorKey('canvas', 'down', { key: 'f8' }, true)?.action, 'view.pan-lock', 'whileTyping bindings cut through the gate');
  // a pan key released while a text field has focus must still release —
  // otherwise the view drifts forever (the stranded-pan failure mode)
  assertEqual(resolveEditorKey('canvas', 'up', { key: 'w' }, true)?.action, 'view.pan', 'release bypasses the gate');
});

test('release resolution: held bindings only, base-key matched', () => {
  assertEqual(resolveEditorKey('canvas', 'up', { key: 'w', ctrlKey: true }, false)?.action, 'view.pan', 'a modifier pressed mid-hold cannot strand the release');
  assertEqual(resolveEditorKey('iso-build', 'up', { key: 'r' }, false), null, 'press actions never dispatch a release phase');
  assertEqual(resolveEditorKey('iso-build', 'up', { key: 'arrowup' }, false)?.action, 'view.pan', 'arrow aliases release like their wasd twins');
});

test('the legend derives from the dispatch rows — it cannot lie', () => {
  const canvas = legendForScope('canvas');
  assert(canvas.some((r) => r.legend === 'WASD pan'), 'the canvas legend teaches the pan');
  assert(canvas.some((r) => r.legend === 'F8 lock'), 'the canvas legend teaches the focus lock');
  for (const row of canvas) {
    const backing = bindingsForScope('canvas').find((b) => b.legend === row.legend);
    assert(!!backing, `legend row "${row.legend}" is a real binding`);
    assertEqual(row.keys, backing!.keys.join('/'), 'legend keys are the binding keys, verbatim');
  }
  assert(legendForScope('iso-build').length > 0, 'every scope can render a legend');
});

test('user overrides: rebinding layers over the default and dispatch follows', () => {
  loadUserBindings({}); // clean slate
  const r = setUserBinding('studio', 'view.recenter', ['k']);
  assert(r.ok, 'a free chord rebinds');
  assertEqual(bindingsForScope('studio').find((b) => b.action === 'view.recenter')?.keys.join(','), 'k', 'the effective keys are the override');
  assertEqual(resolveEditorKey('studio', 'down', { key: 'k' }, false)?.action, 'view.recenter', 'dispatch fires on the new chord');
  assertEqual(resolveEditorKey('studio', 'down', { key: 'f' }, false), null, 'the old default no longer fires');
  assert(isOverridden('studio', 'view.recenter'), 'the action reads as overridden');
  clearUserBinding('studio', 'view.recenter');
  assertEqual(bindingsForScope('studio').find((b) => b.action === 'view.recenter')?.keys.join(','), 'f,home', 'reset restores the default');
});

test('user overrides: a chord already bound in the scope is rejected, not crashed', () => {
  loadUserBindings({});
  const r = setUserBinding('studio', 'view.recenter', ['escape']); // escape = selection.cancel
  assert(!r.ok, 'a clash returns a conflict');
  assert(!isOverridden('studio', 'view.recenter'), 'the rejected rebind is not applied');
  assertEqual(setUserBinding('studio', 'view.recenter', ['Bad!!']).ok, false, 'a malformed chord is rejected');
});

test('user overrides: persistence round-trips and drops corruption', () => {
  loadUserBindings({});
  setUserBinding('studio', 'selection.all', ['ctrl+g']);
  const saved = exportUserBindings();
  assertEqual(saved['studio:selection.all']?.join(','), 'ctrl+g', 'export captures the override');
  loadUserBindings({ 'studio:view.recenter': ['k'], 'studio:junk': ['NOT A CHORD'] });
  assertEqual(bindingsForScope('studio').find((b) => b.action === 'view.recenter')?.keys.join(','), 'k', 'a saved override hydrates');
  assert(!isOverridden('studio', 'selection.all'), 'load REPLACES the map (the prior override is gone)');
  assertEqual(exportUserBindings()['studio:junk'], undefined, 'a malformed entry is dropped on load');
  loadUserBindings({}); // leave the global map clean for any later test
});

test('capture mode suppresses all dispatch (so binding Delete cannot delete)', () => {
  setKeyCapture(true);
  assertEqual(resolveEditorKey('studio', 'down', { key: 'delete' }, false), null, 'nothing dispatches mid-capture');
  setKeyCapture(false);
  assertEqual(resolveEditorKey('studio', 'down', { key: 'delete' }, false)?.action, 'selection.delete', 'dispatch resumes after capture');
});

test('prettyChord renders human labels', () => {
  assertEqual(prettyChord('ctrl+shift+z'), 'Ctrl+Shift+Z', 'modifiers capitalize');
  assertEqual(prettyChord('escape'), 'Esc', 'named keys get short labels');
  assertEqual(prettyChord('f'), 'F', 'single keys uppercase');
});

finish('editors/controls');
