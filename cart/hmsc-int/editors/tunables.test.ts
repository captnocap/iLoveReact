// tunables.test.ts — P4 behavior tests for THE P2 registry (editors/tunables.ts).
//
// The contract under test: a tuning module registers its numeric leaves where
// they live; the registry writes THROUGH the live table (the value the route
// reads next frame); reset returns to the registration default; persisted
// overrides fold back over defaults at boot regardless of registration order;
// the 'tuning' stream materializes the override map and replays identically.
//
// Registry cases are pure (no host bindings). The persistence round trip runs
// against a real scratch store under zig-out/ — the sessions.test.ts idiom.

import { openStore } from '../data';
import { createTunables, tuningStream, type TunableSpec } from './tunables';
import { assert, assertEqual, assertThrows, finish, test } from '../game/_testkit';

declare const globalThis: any;

const ROOT = 'zig-out/game/test-tunables';

function wipeScratch(): void {
  for (const path of [
    `${ROOT}/streams/tuning.jsonl`,
    `${ROOT}/snapshots/tuning.snapshot.json`,
  ]) globalThis.__fs_remove?.(path);
}

const spec = (label: string, min: number, max: number, step = 1, precision = 0): TunableSpec =>
  ({ label, min, max, step, precision });

function demoTable() {
  return {
    brushPx: 32,
    cursor: { throttleMs: 60 },
  };
}

test('register/read/write/reset round-trips through the live table', () => {
  const reg = createTunables();
  const table = demoTable();
  reg.register({
    system: 'demo', route: '/demo', table,
    specs: { 'brushPx': spec('brush px', 1, 512), 'cursor.throttleMs': spec('cursor throttle', 0, 500, 10) },
  });
  assertEqual(reg.read('demo.brushPx'), 32, 'read returns the registration value');
  assertEqual(reg.write('demo.brushPx', 64), 64, 'write returns the applied value');
  assertEqual(table.brushPx, 64, 'write lands in the LIVE table the consumer reads');
  assertEqual(reg.read('demo.cursor.throttleMs'), 60, 'nested dotted path resolves');
  reg.write('demo.cursor.throttleMs', 120);
  assertEqual(table.cursor.throttleMs, 120, 'nested write lands through the path');
  assert(!reg.isDefault('demo.brushPx'), 'edited knob is not at default');
  assertEqual(reg.reset('demo.brushPx'), 32, 'reset returns the default');
  assertEqual(table.brushPx, 32, 'reset lands in the table');
  assert(reg.isDefault('demo.brushPx'), 'reset knob is at default');
});

test('write clamps at the boundary and rejects garbage', () => {
  const reg = createTunables();
  const table = demoTable();
  reg.register({ system: 'demo', route: '/demo', table, specs: { 'brushPx': spec('brush px', 1, 512) } });
  assertEqual(reg.write('demo.brushPx', 9999), 512, 'over-max clamps to max');
  assertEqual(reg.write('demo.brushPx', -5), 1, 'under-min clamps to min');
  assertThrows(() => reg.write('demo.brushPx', Number.NaN), 'non-finite value must throw');
  assertThrows(() => reg.write('demo.nope', 1), 'unknown id must throw');
  assertThrows(() => reg.read('demo.nope'), 'unknown id read must throw');
});

test('registration validates spec/table drift loud (P3 boundary)', () => {
  const reg = createTunables();
  assertThrows(
    () => reg.register({ system: 'demo', route: '/demo', table: { a: 'str' }, specs: { a: spec('a', 0, 1) } }),
    'a non-numeric leaf must throw',
  );
  assertThrows(
    () => reg.register({ system: 'demo', route: '/demo', table: { a: 5 }, specs: { a: spec('a', 0, 1) } }),
    'a default outside [min,max] must throw',
  );
  assertThrows(
    () => reg.register({ system: 'Demo!', route: '/demo', table: { a: 0.5 }, specs: { a: spec('a', 0, 1) } }),
    'a non-kebab system must throw',
  );
  reg.register({ system: 'demo', route: '/demo', table: { a: 0.5 }, specs: { a: spec('a', 0, 1, 0.1, 1) } });
  assertThrows(
    () => reg.register({ system: 'demo', route: '/demo', table: { a: 0.5 }, specs: { a: spec('a', 0, 1, 0.1, 1) } }),
    'a duplicate id must throw',
  );
});

test('applyOverrides folds persisted values over defaults, any registration order', () => {
  const reg = createTunables();
  const early = demoTable();
  reg.register({ system: 'early', route: '/a', table: early, specs: { brushPx: spec('px', 1, 512) } });
  // overrides arrive (the boot fold) — one registered, one not yet, one noise
  reg.applyOverrides({ 'early.brushPx': 100, 'late.brushPx': 200, 'noise.x': Number.NaN });
  assertEqual(early.brushPx, 100, 'registered tunable takes its override immediately');
  const late = demoTable();
  reg.register({ system: 'late', route: '/b', table: late, specs: { brushPx: spec('px', 1, 512) } });
  assertEqual(late.brushPx, 200, 'late registration picks its pending override up');
  assertEqual(reg.list().length, 2, 'noise ids never become entries');
  // pending override clamps through the same boundary
  reg.applyOverrides({ 'later.brushPx': 9999 });
  const later = demoTable();
  reg.register({ system: 'later', route: '/c', table: later, specs: { brushPx: spec('px', 1, 512) } });
  assertEqual(later.brushPx, 512, 'pending override clamps at registration');
});

test('revision bumps on every mutation — the page poll signal', () => {
  const reg = createTunables();
  const r0 = reg.revision();
  reg.register({ system: 'demo', route: '/demo', table: demoTable(), specs: { brushPx: spec('px', 1, 512) } });
  const r1 = reg.revision();
  assert(r1 > r0, 'register bumps');
  reg.write('demo.brushPx', 50);
  assert(reg.revision() > r1, 'write bumps');
});

test('the tuning stream materializes overrides; reset removes; unknown kinds pass', () => {
  let state = tuningStream.initial();
  state = tuningStream.apply(state, { kind: 'set', id: 'a.x', value: 3 });
  state = tuningStream.apply(state, { kind: 'set', id: 'b.y', value: 7 });
  state = tuningStream.apply(state, { kind: 'set', id: 'a.x', value: 4 });
  assertEqual(state.overrides['a.x'], 4, 'last set wins');
  assertEqual(state.overrides['b.y'], 7, 'sets are independent');
  state = tuningStream.apply(state, { kind: 'reset', id: 'a.x' });
  assert(!('a.x' in state.overrides), 'reset removes the override');
  const before = state;
  state = tuningStream.apply(state, { kind: 'mystery', extra: true } as any);
  assertEqual(state, before, 'unknown kinds pass through untouched (V20)');
  state = tuningStream.apply(state, { kind: 'reset', id: 'never.set' });
  assertEqual(state, before, 'resetting an absent override is a same-ref no-op');
});

test('store round trip: edits persist, fold back at boot, replay identically', () => {
  wipeScratch();
  {
    const store = openStore(ROOT);
    const channel = store.defineStream(tuningStream);
    channel.append({ kind: 'set', id: 'demo.brushPx', value: 64 });
    channel.append({ kind: 'set', id: 'demo.cursor.throttleMs', value: 120 });
    channel.append({ kind: 'set', id: 'demo.brushPx', value: 80 });
    channel.append({ kind: 'reset', id: 'demo.cursor.throttleMs' });
    store.materializeSnapshots();
  }
  {
    // a fresh process: registration defaults + the persisted fold
    const store = openStore(ROOT);
    const channel = store.defineStream(tuningStream);
    const reg = createTunables();
    const table = demoTable();
    reg.applyOverrides(channel.state().overrides); // boot fold BEFORE this module registered
    reg.register({
      system: 'demo', route: '/demo', table,
      specs: { 'brushPx': spec('px', 1, 512), 'cursor.throttleMs': spec('ms', 0, 500, 10) },
    });
    assertEqual(table.brushPx, 80, 'the persisted edit survives the restart');
    assertEqual(table.cursor.throttleMs, 60, 'the reset knob is back on its code default');
    // the snapshot the compile would load says the same thing
    const snap = store.loadSnapshot<{ overrides: Record<string, number> }>('tuning');
    assertEqual(snap?.state.overrides['demo.brushPx'], 80, 'snapshot carries the override');
    assert(!('demo.cursor.throttleMs' in (snap?.state.overrides ?? {})), 'snapshot dropped the reset');
  }
});

finish('tunables');
