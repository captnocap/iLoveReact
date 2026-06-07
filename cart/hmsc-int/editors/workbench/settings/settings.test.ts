// editors/workbench/settings/settings.test.ts — P4 behavior suite for the
// SETTINGS WorkbenchSource (WBSET9-0606): the panel is GENERATED from the
// registry (roster = systems, groups by owning route, num fields carrying
// the registry's own knob shape), set() writes THROUGH the live table and
// lands the route-parity V20 tuning commit, reset returns to the
// registration default with the route's label shape, and the rig folds
// (knob bars + tuning feed) read true.
//
//   tools/esbuild cart/hmsc-int/editors/workbench/settings/settings.test.ts \
//     --bundle --outfile=zig-out/game/tests/wb_settings.test.js --format=iife \
//     --platform=neutral --target=es2022 --alias:@reactjit=runtime \
//     --alias:@game=cart/hmsc-int/game
//   tools/v8cli zig-out/game/tests/wb_settings.test.js
//
// (`rjit game verify` runs it via the cart/hmsc-int/editors suite root.)
// Headless per the characters.test.ts bundling law: panel.ts + store.ts only
// (never source.tsx/rigs.tsx — the React half); a fresh createTunables() and
// a fake session/bus stand in for the live doors.

import { assert, assertClose, assertEqual, finish, test } from '../../../game/_testkit';
import { createTunables, type TunableEntry } from '../../tunables';
import type { SessionsState } from '../../sessions';
import { createSettingsStore, type SettingsStore } from './store';
import { knobBars, settingsPanel, settingsRoster, systemRoutes, tuningFeed } from './panel';

type Committed = { event: any; label: string };

function fixture(bus: SessionsState | null = null): { store: SettingsStore; commits: Committed[] } {
  const t = createTunables();
  // two systems, one with two owning routes (the mixed-table case)
  const rigA = { speed: 4, jump: { height: 1.2 } };
  t.register({
    system: 'rig-a', route: '/alpha', table: rigA,
    specs: {
      speed: { label: 'speed', min: 0, max: 10, step: 0.5, precision: 1 },
      'jump.height': { label: 'jump height', min: 0.2, max: 3, step: 0.1, precision: 1 },
    },
  });
  const rigB = { gain: 50 };
  t.register({
    system: 'rig-b', route: '/beta', table: rigB,
    specs: { gain: { label: 'gain', min: 0, max: 100, step: 5, precision: 0 } },
  });
  const commits: Committed[] = [];
  const store = createSettingsStore({
    tunables: t,
    session: { commit: (event, label) => { commits.push({ event, label }); } },
    error: null,
    bus: () => bus,
  });
  return { store, commits };
}

test('the roster is GENERATED: one row per registered system, registration order', () => {
  const { store } = fixture();
  assertEqual(JSON.stringify(settingsRoster(store)), JSON.stringify([
    { id: 'rig-a', label: 'rig-a' },
    { id: 'rig-b', label: 'rig-b' },
  ]), 'roster mirrors the registry');
});

test('the panel is GENERATED: route group + one group per dotted cluster, num fields carry the registry knob shape', () => {
  const { store } = fixture();
  const spec = settingsPanel(store, 'rig-a');
  // SETDENSE-0607: dotless leaves under the route header, dotted paths under
  // their table cluster — `jump.height` gets its own JUMP section
  assertEqual(spec.groups.length, 2, 'route group + the jump.* cluster');
  assertEqual(spec.groups[0].title, '/ALPHA', 'dotless knobs titled by route');
  assertEqual(spec.groups[1].title, 'JUMP', 'dotted knobs titled by their cluster key');
  assertEqual(spec.groups[0].fields.length, 1, 'speed under the route header');
  assertEqual(spec.groups[1].fields.length, 1, 'jump.height under JUMP');
  assertEqual(spec.groups[0].layout, 'rows', 'settings groups render one field per row (the density verdict)');
  const f = spec.groups[0].fields[0] as any;
  assertEqual(f.t, 'num', 'tunables generate num fields');
  assertEqual(`${f.min}|${f.max}|${f.step}|${f.precision}`, '0|10|0.5|1', 'spec numbers verbatim from the registry');
  assertEqual(f.get(), 4, 'get reads the live table');
});

test('set() clamps, writes THROUGH the live table, and lands the route-parity tuning commit', () => {
  const { store, commits } = fixture();
  const entry = store.entries('rig-a')[0];
  const applied = store.set(entry, 99); // beyond max → clamp
  assertEqual(applied, 10, 'clamped to the registered max');
  assertEqual(store.read('rig-a.speed'), 10, 'the live table moved');
  assertEqual(commits.length, 1, 'one V20 tuning commit');
  assertEqual(commits[0].event.kind, 'set', 'a set event');
  assertEqual(commits[0].label, `rig-a.speed → ${store.formatValue(10, entry)}`, 'the SettingsRoute label shape');
});

test('reset() returns to the registration default and commits the route label shape', () => {
  const { store, commits } = fixture();
  const entry = store.entries('rig-b')[0];
  store.set(entry, 80);
  assert(!store.isDefault('rig-b.gain'), 'overridden after set');
  const value = store.reset(entry);
  assertEqual(value, 50, 'back to the registration default');
  assert(store.isDefault('rig-b.gain'), 'default again');
  assertEqual(commits[1].event.kind, 'reset', 'a reset event');
  assertEqual(commits[1].label, `rig-b.gain → default (${store.formatValue(50, entry)})`, 'the route reset label');
});

test('the panel reset rider: hint is the formatted default, isDefault tracks, run resets', () => {
  const { store } = fixture();
  const spec = settingsPanel(store, 'rig-b');
  const f = spec.groups[0].fields[0] as any;
  assert(f.reset, 'every generated num field carries the reset affordance (census C8)');
  assertEqual(f.reset.hint, store.formatValue(50, store.entries('rig-b')[0]), 'hint = formatted default');
  assert(f.reset.isDefault(), 'at default before edits');
  f.set(80);
  assert(!f.reset.isDefault(), 'overridden after a field set');
  f.reset.run();
  assert(f.reset.isDefault(), 'the rider resets');
  assertEqual(f.get(), 50, 'value back at default');
});

test('knobBars: value fill + default tick in range, overridden flags true', () => {
  const { store } = fixture();
  const entry = store.entries('rig-a')[0];
  store.set(entry, 8);
  const bars = knobBars(store, 'rig-a');
  assertEqual(bars.length, 2, 'one bar per knob');
  assertClose(bars[0].frac, 0.8, 1e-12, 'value position in [min,max]');
  assertClose(bars[0].defaultFrac, 0.4, 1e-12, 'default tick position');
  assert(bars[0].overridden, 'the edited knob reads overridden');
  assert(!bars[1].overridden, 'the untouched knob does not');
  assertEqual(store.overriddenCount('rig-a'), 1, 'overridden count');
  assertEqual(store.knobCount('rig-a'), 2, 'system knob count');
  assertEqual(store.knobCount(), 3, 'registry knob count');
});

test('tuningFeed: only this system\'s tuning-channel commits, newest first, capped', () => {
  const mk = (seq: number, channel: string, label: string) => ({ seq, label, at: seq });
  const bus: SessionsState = {
    sessions: {
      s1: { id: 's1', route: '/settings', channel: 'tuning', closedSeq: null, commits: [mk(3, 'tuning', 'rig-a.speed → 8.0'), mk(9, 'tuning', 'rig-a.jump.height → 2.0'), mk(5, 'tuning', 'rig-b.gain → 80')] },
      s2: { id: 's2', route: '/characters', channel: 'characters', closedSeq: 12, commits: [mk(7, 'characters', 'autosave · rig-a.fake')] },
    } as any,
    order: ['s1', 's2'],
  } as SessionsState;
  const { store } = fixture(bus);
  const feed = tuningFeed(store, 'rig-a', 10);
  assertEqual(feed.length, 2, 'only rig-a tuning commits (the characters channel row never leaks in)');
  assertEqual(`${feed[0].seq},${feed[1].seq}`, '9,3', 'newest first by global seq');
  assertEqual(tuningFeed(store, 'rig-a', 1).length, 1, 'cap honored');
  assertEqual(tuningFeed(store, 'rig-b', 10).length, 1, 'sibling system sees its own');
});

test('systemRoutes folds owning routes for the rig caption; store surfaces the bus error', () => {
  const { store } = fixture();
  assertEqual(systemRoutes(store.entries('rig-a') as TunableEntry[]), '/alpha', 'single route');
  const t = createTunables();
  t.register({ system: 'rig-c', route: '/one', table: { a: 1 }, specs: { a: { label: 'a', min: 0, max: 2, step: 1, precision: 0 } } });
  t.register({ system: 'rig-c2', route: '/two', table: { b: 1 }, specs: { b: { label: 'b', min: 0, max: 2, step: 1, precision: 0 } } });
  const down = createSettingsStore({ tunables: t, session: null, error: 'corrupt record at sessions.jsonl:884', bus: () => null });
  assertEqual(down.error(), 'corrupt record at sessions.jsonl:884', 'the census C3 warning is namable');
  const entry = down.entries('rig-c')[0];
  assertEqual(down.set(entry, 2), 2, 'a down session still writes through (registry stays editable)');
  assertEqual(tuningFeed(down, 'rig-c', 5).length, 0, 'no bus → empty feed, never a throw');
});

finish('workbench/settings');
