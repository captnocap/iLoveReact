// scripts/ffi-sweep-smoke.ts
//
// Behaviour-parity test for the runtime/ffi sweep. Each section stubs
// the Zig-side host fns on globalThis, then drives the public hook API
// and confirms the host fns get the expected calls / return shapes.
//
// Run via: scripts/ffi-sweep-smoke
//
// v8cli has microtasks but no setTimeout/setInterval, so we install
// drivable fakes here. The hook modules under test pick them up because
// they read `setInterval` lazily off the global.

(globalThis as any).queueMicrotask = (globalThis as any).queueMicrotask ??
  ((fn: () => void) => Promise.resolve().then(fn));

// ── Fake timers ───────────────────────────────────────────────────
// One global tick counter; intervals/timeouts schedule against it and the
// test advances time by calling `tick(ms)`.

interface FakeTimer {
  id: number;
  fn: () => void;
  due: number;
  every: number; // 0 = one-shot
  cancelled: boolean;
}

let now = 0;
let nextTimerId = 1;
const timers: FakeTimer[] = [];

(globalThis as any).setInterval = (fn: () => void, ms: number): number => {
  const t: FakeTimer = { id: nextTimerId++, fn, due: now + ms, every: ms, cancelled: false };
  timers.push(t);
  return t.id;
};
(globalThis as any).setTimeout = (fn: () => void, ms: number): number => {
  const t: FakeTimer = { id: nextTimerId++, fn, due: now + ms, every: 0, cancelled: false };
  timers.push(t);
  return t.id;
};
(globalThis as any).clearInterval = (id: number): void => {
  for (const t of timers) if (t.id === id) t.cancelled = true;
};
(globalThis as any).clearTimeout = (globalThis as any).clearInterval;

function tick(ms: number): void {
  const target = now + ms;
  while (true) {
    // Find the next non-cancelled timer due before/at target.
    let next: FakeTimer | null = null;
    for (const t of timers) {
      if (t.cancelled) continue;
      if (t.due > target) continue;
      if (!next || t.due < next.due) next = t;
    }
    if (!next) break;
    now = next.due;
    if (next.every > 0) next.due += next.every;
    else next.cancelled = true;
    try { next.fn(); } catch (e: any) { console.log('  ! timer threw: ' + (e?.message ?? e)); }
  }
  now = target;
  // Drop cancelled entries so the array doesn't grow unbounded.
  for (let i = timers.length - 1; i >= 0; i--) if (timers[i].cancelled) timers.splice(i, 1);
}

// ── Stub host surface ─────────────────────────────────────────────
const G = globalThis as any;

const calls: Array<{ name: string; args: any[] }> = [];
function rec(name: string): (...args: any[]) => any {
  return (...args: any[]) => {
    calls.push({ name, args });
    return undefined;
  };
}
function takeCalls(): Array<{ name: string; args: any[] }> {
  const out = calls.slice();
  calls.length = 0;
  return out;
}

// fswatch stubs — return shape matches framework/fswatch.zig
let nextFswatchId = 100;
const fswatchQueue: any[] = [];
G.__fswatchAdd = (path: string, recursive: number, intervalMs: number, pattern: string) => {
  calls.push({ name: '__fswatchAdd', args: [path, recursive, intervalMs, pattern] });
  return nextFswatchId++;
};
G.__fswatchRemove = rec('__fswatchRemove');
G.__fswatchDrain = () => {
  calls.push({ name: '__fswatchDrain', args: [] });
  if (fswatchQueue.length === 0) return '[]';
  return JSON.stringify(fswatchQueue.splice(0));
};

// ── Imports under test ────────────────────────────────────────────
import { attachWatcher } from '../runtime/hooks/useFileWatch';

// ── Test harness ──────────────────────────────────────────────────

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean, note?: string): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; failures.push(name + (note ? ` — ${note}` : '')); console.log(`  ✗ ${name}${note ? ' — ' + note : ''}`); }
}
function eq<T>(name: string, actual: T, expected: T): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  ok(name, a === b, a === b ? undefined : `expected ${b}, got ${a}`);
}
function section(label: string): void { console.log(`\n[${label}]`); }

function run(): void {

  section('useFileWatch — attachWatcher');
  {
    takeCalls();
    const events: any[] = [];
    const off = attachWatcher('config.json', (ev) => events.push(ev), {
      recursive: false,
      intervalMs: 250,
      pattern: '*.json',
    });

    const addCalls = takeCalls().filter((c) => c.name === '__fswatchAdd');
    eq('attachWatcher invokes __fswatchAdd once', addCalls.length, 1);
    eq('attachWatcher passes path', addCalls[0]?.args[0], 'config.json');
    eq('attachWatcher passes recursive=0', addCalls[0]?.args[1], 0);
    eq('attachWatcher passes intervalMs', addCalls[0]?.args[2], 250);
    eq('attachWatcher passes pattern', addCalls[0]?.args[3], '*.json');

    // Queue an event and advance time past the 100ms drain interval.
    fswatchQueue.push({ w: 100, t: 'modified', p: 'config.json', s: 42, m: 1234 });
    tick(110);
    eq('drain delivers event count', events.length, 1);
    eq('drain delivers event shape', events[0]?.type, 'modified');
    eq('drain delivers watcherId', events[0]?.watcherId, 100);
    eq('drain delivers path', events[0]?.path, 'config.json');
    eq('drain delivers size', events[0]?.size, 42);
    eq('drain delivers mtimeNs', events[0]?.mtimeNs, 1234);

    // Detach unhooks remove + stops the timer.
    takeCalls();
    off();
    const removeCalls = takeCalls().filter((c) => c.name === '__fswatchRemove');
    eq('detach invokes __fswatchRemove', removeCalls.length, 1);
    eq('detach passes watcher id', removeCalls[0]?.args[0], 100);

    // After detach, queued events should not reach a stale listener.
    fswatchQueue.push({ w: 100, t: 'deleted', p: 'config.json', s: 0, m: 0 });
    tick(200);
    eq('post-detach delivers nothing', events.length, 1);
  }

  section('useFileWatch — fault tolerance');
  {
    // Simulate host fn missing (Zig not wired) by deleting and reattaching.
    const savedAdd = G.__fswatchAdd;
    delete G.__fswatchAdd;
    const off = attachWatcher('missing.txt', () => {}, {});
    ok('host-missing attachWatcher returns noop', typeof off === 'function');
    G.__fswatchAdd = savedAdd;
    off();

    // Drain producing invalid JSON should not throw.
    const events: any[] = [];
    const off2 = attachWatcher('a.txt', (ev) => events.push(ev), {});
    const savedDrain = G.__fswatchDrain;
    G.__fswatchDrain = () => '{not-json';
    tick(200);
    eq('invalid drain JSON skipped silently', events.length, 0);
    G.__fswatchDrain = savedDrain;
    off2();
  }

  // ── Summary ────────────────────────────────────────────────────
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log('  ' + f);
  }
}

run();
