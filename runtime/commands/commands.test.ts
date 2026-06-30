// runtime/commands/commands.test.ts — locks the command + keybinding registry:
// registration + anti-collision, the menu↔hotkey "same command" rule, the chord
// normalizer, and the EMIT contract (running a command dispatches its editorbus
// event). Self-contained micro-harness — the repo has no test framework.
//
//   tools/esbuild runtime/commands/commands.test.ts --bundle \
//     --outfile=/tmp/commands.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit=runtime
//   tools/v8cli /tmp/commands.test.js

import {
  defineCommand, commandById, commandsByMenu, resolveHotkey, runCommand,
  registeredCommands, hotkeyFor, rebindHotkey, exportHotkeys, loadHotkeys,
  normalizeChord, tryNormalizeChord, chordFromEvent, prettyChord,
  type CommandDef,
} from './index';
import { defineEventType } from '../editorbus/event';
import { dispatch, since, head, onEvent, isHostBacked } from '../editorbus/bus';

// ── micro harness ────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(s + '\n'));
function test(name: string, fn: () => void) {
  try { fn(); passed++; log(`  ok  ${name}`); }
  catch (e) { failed++; log(`FAIL  ${name}: ${(e as Error).message}`); }
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }

// ── the editorbus event a command emits (commands EMIT, never mutate) ─────────
type DeleteP = { count: number };
const deleteSelection = defineEventType<DeleteP>({
  type: 'test.selection.delete',
  undoable: true,
  describe: (p) => `delete ${p.count}`,
});

// ── two commands: one menu-only, one hotkeyed + emitting ──────────────────────
const newMap: CommandDef = defineCommand({
  id: 'test.new-map', menu: 'File', label: 'New Map', icon: 'FilePlus2',
  defaultKey: 'Ctrl+N', undoable: false, native: true,
  run: () => { dispatch(deleteSelection({ count: 0 })); },
});

let lastDeleteCount = -1;
const delCmd: CommandDef = defineCommand({
  id: 'test.delete-selection', menu: 'Edit', label: 'Delete Selection', icon: 'Trash2',
  defaultKey: 'Delete', undoable: true, native: true,
  run: (ctx) => {
    const ids = ctx.targets ?? [];
    lastDeleteCount = ids.length;
    dispatch(deleteSelection({ count: ids.length }, ids));
  },
});

// ── keychord normalizer ──────────────────────────────────────────────────────
test('normalizeChord canonicalizes spelling + modifier order', () => {
  assert(normalizeChord('Ctrl+Shift+Z') === 'ctrl+shift+z', 'mods lowercased');
  assert(normalizeChord('shift+z+control') === 'ctrl+shift+z', 'reordered to ctrl+alt+shift+meta');
  assert(normalizeChord('Cmd+A') === 'meta+a', 'cmd → meta alias');
  assert(normalizeChord('Esc') === 'escape', 'base-key alias');
  assert(normalizeChord('F9') === 'f9', 'bare function key, no mods');
});

test('a malformed chord throws; tryNormalizeChord swallows it', () => {
  let threw = false;
  try { normalizeChord('ctrl+alt'); } catch { threw = true; }
  assert(threw, 'no base key must throw');
  assert(tryNormalizeChord('ctrl+alt') === null, 'try-variant returns null on junk');
  assert(prettyChord('ctrl+shift+z') === 'Ctrl+Shift+Z', 'pretty for display');
});

test('chordFromEvent matches the normalized default key', () => {
  const ev = { key: 'N', ctrlKey: true };
  assert(chordFromEvent(ev) === 'ctrl+n', 'event → canonical chord');
  assert(chordFromEvent(ev) === normalizeChord(newMap.defaultKey!), 'event chord == registered chord');
});

// ── registration + anti-collision ────────────────────────────────────────────
test('a registered command is retrievable by id', () => {
  assert(commandById('test.new-map') === newMap, 'commandById returns the def');
  assert(registeredCommands().some((c) => c.id === 'test.delete-selection'), 'listed for the palette');
});

test('re-registering an id is rejected (anti-collision seam)', () => {
  let threw = false;
  try { defineCommand({ id: 'test.new-map', menu: 'File', label: 'dup', icon: 'X', undoable: false, native: false, run: () => {} }); }
  catch { threw = true; }
  assert(threw, 'duplicate id must throw');
});

test('a duplicate default hotkey is rejected at registration', () => {
  let threw = false;
  try { defineCommand({ id: 'test.dup-key', menu: 'Edit', label: 'clash', icon: 'X', defaultKey: 'ctrl+n', undoable: false, native: false, run: () => {} }); }
  catch { threw = true; }
  assert(threw, 'second command on Ctrl+N must throw');
});

// ── menu and hotkey resolve to the SAME command ──────────────────────────────
test('menu lookup and hotkey lookup land on one identical command', () => {
  const fromMenu = commandsByMenu('File').find((c) => c.id === 'test.new-map');
  const fromKey = resolveHotkey('Ctrl+N');
  const fromKeyAltSpelling = resolveHotkey('control+n');
  assert(fromMenu === newMap, 'menu yields the def');
  assert(fromKey === newMap, 'hotkey yields the def');
  assert(fromMenu === fromKey, 'menu === hotkey (text menu is source of truth)');
  assert(fromKeyAltSpelling === fromKey, 'any chord spelling resolves to the same command');
});

test('resolveHotkey returns undefined for an unbound or junk chord', () => {
  assert(resolveHotkey('Ctrl+Q') === undefined, 'unbound chord');
  assert(resolveHotkey('ctrl+alt') === undefined, 'malformed chord, no throw');
});

// ── running a command dispatches the expected editorbus event ─────────────────
test('running a command EMITs its editorbus event (via the local fallback)', () => {
  assert(!isHostBacked(), 'bare v8cli → local editorbus fallback');
  const base = head();
  const seen: string[] = [];
  const off = onEvent((e) => seen.push(e.type));

  // run by hotkey resolution — proves the keypress path emits
  const cmd = resolveHotkey('Delete')!;
  cmd.run({ targets: [{ kind: 'piece', id: 'wall-1' }, { kind: 'piece', id: 'wall-2' }] });
  off();

  assert(lastDeleteCount === 2, 'run() saw its context targets');
  const tail = since(base);
  assert(tail.length === 1, 'exactly one event committed');
  assert(tail[0]!.type === 'test.selection.delete', 'the expected event type was dispatched');
  assert((tail[0]!.payload as DeleteP).count === 2, 'payload built from ctx');
  assert(tail[0]!.targets.length === 2, 'targets carried into the envelope');
  assert(seen.length === 1 && seen[0] === 'test.selection.delete', 'subscriber saw the emit');
});

test('runCommand(id) dispatches the same way as run()', () => {
  const base = head();
  runCommand('test.delete-selection', { targets: [{ kind: 'piece', id: 'x' }] });
  const tail = since(base);
  assert(tail.length === 1 && tail[0]!.type === 'test.selection.delete', 'runCommand emitted');
});

// ── light rebinding + persistence ────────────────────────────────────────────
test('rebindHotkey moves the chord; the OLD chord stops resolving', () => {
  const r = rebindHotkey('test.delete-selection', 'Backspace');
  assert(r.ok, 'rebind to a free chord succeeds');
  assert(resolveHotkey('Backspace') === delCmd, 'new chord resolves');
  assert(resolveHotkey('Delete') === undefined, 'old chord released');
  assert(hotkeyFor('test.delete-selection') === 'backspace', 'effective chord updated');
});

test('rebind onto another command\'s chord is rejected (no crash)', () => {
  const r = rebindHotkey('test.delete-selection', 'Ctrl+N');
  assert(!r.ok && /already bound/.test((r as any).conflict), 'collision reported, not thrown');
});

test('export/load round-trips only the user rebinds', () => {
  const saved = exportHotkeys();
  assert(saved['test.delete-selection'] === 'backspace', 'only the rebound id is exported');
  assert(!('test.new-map' in saved), 'untouched defaults are not exported');
  // re-applying a saved map is idempotent (same chord on the same command)
  loadHotkeys(saved);
  assert(resolveHotkey('Backspace') === delCmd, 'load reapplies cleanly');
  // junk entries are silently dropped
  loadHotkeys({ 'no.such.command': 'ctrl+j', 'test.new-map': 'not a chord' });
  assert(resolveHotkey('Ctrl+N') === newMap, 'corrupt store never breaks input');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) (globalThis as any).__exit?.(1);
