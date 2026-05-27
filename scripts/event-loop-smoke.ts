// tests/event-loop-smoke.ts
//
// Standalone smoke test for the framework/runtime event loop.
// Bundles the actual runtime modules + runs them under tools/v8cli
// (no React, no Zig host bindings — vsock falls through to LocalPair).
//
// Reproduce:
//
//   tools/esbuild tests/event-loop-smoke.ts \
//     --bundle --platform=neutral --format=iife --target=es2022 \
//     --outfile=.cache/event-loop-smoke.bundle.js \
//     --tsconfig-raw='{"compilerOptions":{"target":"es2022","module":"esnext","moduleResolution":"bundler","strict":false}}'
//   tools/v8cli .cache/event-loop-smoke.bundle.js
//
// Output is a per-section matrix and a final pass/fail count. Exit
// code is not propagated (v8cli has no built-in `process.exit`); the
// failure list is printed at the end.

(globalThis as any).queueMicrotask = (globalThis as any).queueMicrotask ??
  ((fn: () => void) => Promise.resolve().then(fn));

import { subscribe, emit, subscribeAll } from '../runtime/ffi';
import { resolveTrigger } from '../runtime/hooks/ifttt/registry';
import { registerGate } from '../runtime/hooks/ifttt/gate';
import { similarity } from '../runtime/hooks/ifttt/repeat';
import { openVsock, mirrorChannel, namespaceMirror, namespaceForward } from '../runtime/hooks/vsock';

// Side-effect imports — register the sources.
import '../runtime/hooks/ifttt/match';
import '../runtime/hooks/ifttt/count';
import '../runtime/hooks/ifttt/firsthit';
import '../runtime/hooks/ifttt/repeat';

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

function section(label: string): void {
  console.log(`\n[${label}]`);
}

function flush(): Promise<void> {
  return new Promise((res) => {
    Promise.resolve().then(() => Promise.resolve().then(() => res()));
  });
}

// ── Tests ─────────────────────────────────────────────────────────

async function run() {

  section('bus fundamentals');
  {
    const got: any[] = [];
    const off = subscribe('test:hello', (p) => got.push(p));
    emit('test:hello', { x: 1 });
    emit('test:hello', { x: 2 });
    eq('subscribe receives 2 emits', got.length, 2);
    eq('subscribe payload first', got[0]?.x, 1);
    off();
    emit('test:hello', { x: 3 });
    eq('after unsubscribe no more emits', got.length, 2);
  }
  {
    let count = 0;
    const off = subscribeAll((channel) => {
      if (channel.startsWith('wild:')) count++;
    });
    emit('wild:a', 1);
    emit('wild:b', 2);
    emit('not-matching', 3);
    eq('subscribeAll fires for matching prefix only', count, 2);
    off();
  }

  section('match: source');
  {
    let hit: any = null;
    const sub = resolveTrigger('match:event:append::pkill -f');
    ok('match: resolves', sub != null);
    if (sub) {
      const off = sub.subscribe((p) => { hit = p; });
      emit('event:append', { kind: 'tool_use', name: 'Bash', payload: { cmd: 'pkill -f node' } });
      eq('match: hit channel', hit?.channel, 'event:append');
      eq('match: hit pattern matched', hit?.match, 'pkill -f');
      off();
    }
  }
  {
    let hits = 0;
    const sub = resolveTrigger('match:event:append::/git\\s+add\\s+-A/i');
    if (sub) {
      const off = sub.subscribe(() => hits++);
      emit('event:append', { line: 'about to git add -A everything' });
      emit('event:append', { line: 'unrelated' });
      emit('event:append', { line: 'GIT ADD -A please' });
      eq('match: regex case-insensitive count', hits, 2);
      off();
    }
  }

  section('count: source');
  {
    let fires = 0;
    const sub = resolveTrigger('count:test:beep::3:1000');
    if (sub) {
      const off = sub.subscribe(() => fires++);
      emit('test:beep', 1);
      emit('test:beep', 2);
      eq('count: not yet at threshold', fires, 0);
      emit('test:beep', 3);
      eq('count: fires at threshold', fires, 1);
      emit('test:beep', 4);
      emit('test:beep', 5);
      eq('count: edge-triggered (no re-fire while above)', fires, 1);
      off();
    }
  }

  section('firsthit: source');
  {
    let hits = 0;
    const sub = resolveTrigger('firsthit:test:once::work was destroyed');
    if (sub) {
      const off = sub.subscribe(() => hits++);
      emit('test:once', { line: 'all the work was destroyed in the rebase' });
      emit('test:once', { line: 'still says work was destroyed' });
      emit('test:once', { line: 'work was destroyed again' });
      eq('firsthit: fires exactly once', hits, 1);
      off();
    }
  }

  section('repeat: source (claim-shape similarity)');
  {
    eq('similarity exact', similarity('the fix is in', 'the fix is in'), 1);
    const s = similarity('the fix is in now', 'the fix is in');
    ok('similarity near-duplicate > 0.7', s > 0.7, `got ${s.toFixed(3)}`);
    const t = similarity('the fix is in', 'the moon is bright');
    ok('similarity unrelated < 0.3', t < 0.3, `got ${t.toFixed(3)}`);
  }
  {
    const hits: any[] = [];
    const sub = resolveTrigger('repeat:test:claims::5:0.5');
    if (sub) {
      const off = sub.subscribe((p) => hits.push(p));
      emit('test:claims', 'the bug is fixed now');
      emit('test:claims', 'the moon is bright tonight');
      emit('test:claims', 'the bug is fixed again');
      eq('repeat: fires on near-duplicate claim', hits.length, 1);
      ok('repeat: similarity recorded', hits[0]?.similarity > 0.6, `got ${hits[0]?.similarity?.toFixed(3)}`);
      off();
    }
  }

  section('registerGate (after / suspect / requires)');
  {
    const fires: any[] = [];
    const dispose = registerGate({
      after:    'gate:edit',
      suspect:  'gate:claim',
      requires: 'gate:verify',
      onFire:   (info) => fires.push(info),
    });

    emit('gate:edit', { file: 'a.zig' });
    emit('gate:claim', 'the fix is in');
    eq('gate fires after edit→claim with no verify', fires.length, 1);

    emit('gate:edit', { file: 'b.zig' });
    emit('gate:verify', { exitCode: 0 });
    emit('gate:claim', 'shipped');
    eq('gate disarmed by verify', fires.length, 1);

    emit('gate:claim', 'works');
    eq('gate ignores claim with no open window', fires.length, 1);

    dispose();
  }
  {
    const fires: any[] = [];
    const dispose = registerGate({
      after:    'gate2:edit',
      suspect:  'gate2:claim',
      requires: 'gate2:verify',
      key:      (p: any) => p?.file,
      onFire:   (info) => fires.push(info),
    });

    emit('gate2:edit',   { file: 'a.zig' });
    emit('gate2:edit',   { file: 'b.zig' });
    emit('gate2:verify', { file: 'a.zig' });
    emit('gate2:claim',  { file: 'b.zig', text: 'shipped' });
    eq('gate (keyed): fires for unverified file only', fires.length, 1);
    eq('gate (keyed): correct key', fires[0]?.key, 'b.zig');

    emit('gate2:claim',  { file: 'a.zig', text: 'shipped' });
    eq('gate (keyed): no fire for closed key', fires.length, 1);

    dispose();
  }

  section('vsock LocalPair (no Zig binding)');
  {
    const host = openVsock({ kind: 'host', vmid: 'vm_test_001' });
    const guest = openVsock({ kind: 'guest', vmid: 'vm_test_001' });

    ok('host transport live', host.live);
    ok('guest transport live', guest.live);

    const hostSaw: any[] = [];
    const offHostNS = namespaceMirror(host, 'vm:vm_test_001:');
    const offHostWatch = subscribe('vm:vm_test_001:event:append', (p) => hostSaw.push(p));
    const offGuestOut = mirrorChannel(guest, 'event:append');

    emit('event:append', { kind: 'tool_use', name: 'Edit', file: 'parser.zig' });
    await flush(); await flush();
    eq('host receives guest emit via namespace mirror', hostSaw.length, 1);
    eq('host receives correct payload', hostSaw[0]?.file, 'parser.zig');

    offGuestOut(); offHostWatch(); offHostNS();
    host.close(); guest.close();
  }
  {
    const host = openVsock({ kind: 'host', vmid: 'vm_loop_test' });
    const guest = openVsock({ kind: 'guest', vmid: 'vm_loop_test' });

    const offGuestOut = mirrorChannel(guest, 'supervisor:halt-run');
    const offHostNF = namespaceForward(host, 'vm:vm_loop_test:');

    let guestSaw = 0;
    const offGuestWatch = subscribe('supervisor:halt-run', () => guestSaw++);

    emit('vm:vm_loop_test:supervisor:halt-run', { reason: 'test' });
    await flush(); await flush(); await flush(); await flush();

    eq('production pattern: 1 local fire on guest (no loop)', guestSaw, 1);

    offGuestOut(); offGuestWatch(); offHostNF();
    host.close(); guest.close();
  }
  {
    const host = openVsock({ kind: 'host', vmid: 'vm_test_002' });
    const guest = openVsock({ kind: 'guest', vmid: 'vm_test_002' });

    const off1 = namespaceForward(host, 'vm:vm_test_002:');
    const off2 = mirrorChannel(guest, 'supervisor:halt-run');

    const guestSaw: any[] = [];
    const off3 = subscribe('supervisor:halt-run', (p) => guestSaw.push(p));

    emit('vm:vm_test_002:supervisor:halt-run', { reason: 'pathology' });
    await flush(); await flush();

    eq('host emit on vm:<id>:X reaches guest as X', guestSaw.length, 1);
    eq('payload preserved', guestSaw[0]?.reason, 'pathology');

    off1(); off2(); off3();
    host.close(); guest.close();
  }

  section('end-to-end: claim → forward action → inject-message');
  {
    const claimChannel = 'claim:opened:claim_xyz';
    const injected: any[] = [];

    const dispose = registerGate({
      after:    claimChannel,
      suspect:  'event:append',
      suspectFilter: (p: any) => {
        if (p?.kind !== 'tool_use') return false;
        if (p?.name !== 'Bash') return false;
        const text = JSON.stringify(p);
        return !/exitCode"\s*:\s*0/.test(text);
      },
      requires: 'event:append',
      requiresFilter: (p: any) =>
        p?.kind === 'tool_use' && p?.name === 'Bash' &&
        /exitCode"\s*:\s*0/.test(JSON.stringify(p)),
      onFire: ({ suspectPayload }) => {
        emit('supervisor:inject-message',
          { text: 'You said "fixed". Run the build first.', suspectPayload });
      },
    });

    const offInject = subscribe('supervisor:inject-message', (p) => injected.push(p));

    emit(claimChannel, { id: 'claim_xyz' });
    emit('event:append', { kind: 'tool_use', name: 'Bash', payload: { cmd: 'ls' } });
    await flush();

    eq('inject-message fired on forward action without verify', injected.length, 1);
    ok('inject-message has prompt-back', /Run the build/.test(injected[0]?.text ?? ''));

    dispose(); offInject();
  }
  {
    const claimChannel = 'claim:opened:claim_abc';
    const injected: any[] = [];

    const dispose = registerGate({
      after:    claimChannel,
      suspect:  'event:append',
      suspectFilter: (p: any) => p?.kind === 'tool_use' &&
        p?.name === 'Bash' && !/exitCode"\s*:\s*0/.test(JSON.stringify(p)),
      requires: 'event:append',
      requiresFilter: (p: any) => p?.kind === 'tool_use' &&
        p?.name === 'Bash' && /exitCode"\s*:\s*0/.test(JSON.stringify(p)),
      onFire: () => {
        emit('supervisor:inject-message', { text: 'should not fire' });
      },
    });
    const offInject = subscribe('supervisor:inject-message', (p) => injected.push(p));

    emit(claimChannel, { id: 'claim_abc' });
    emit('event:append', { kind: 'tool_use', name: 'Bash', payload: { exitCode: 0, cmd: 'zig build' } });
    emit('event:append', { kind: 'tool_use', name: 'Bash', payload: { cmd: 'ls' } });
    await flush();

    eq('verify-then-forward does not inject', injected.length, 0);

    dispose(); offInject();
  }

  // ── Summary ─────────────────────────────────────────────────────
  console.log(`\n${'='.repeat(60)}\n  ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log('\n  FAILURES:');
    for (const f of failures) console.log(`    • ${f}`);
  }
}

run().catch((e) => console.error('test crashed:', e));
