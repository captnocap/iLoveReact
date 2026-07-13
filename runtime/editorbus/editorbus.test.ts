// runtime/editorbus/editorbus.test.ts — locks the Phase-0 foundation contract:
// the authoring-event envelope + registration seam, the local-fallback bus
// ordering, and the diagnostics channel branch. Every workstream builds against
// these, so they get a test before any of them fan out.
//
//   tools/esbuild runtime/editorbus/editorbus.test.ts --bundle \
//     --outfile=/tmp/editorbus.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit=runtime
//   tools/v8cli /tmp/editorbus.test.js

import {
  defineEventType, eventTypeDef, describeEvent, registeredEventTypes,
  setPeerId, peerId, SEQ_PENDING, type TargetRef,
} from './event';
import { dispatch, since, head, isHostBacked, onEvent } from './bus';
import { defineChannel, setChannelEnabled, isChannelEnabled, registeredChannels } from '../diag/channel';

// ── micro harness (self-contained; the repo has no test framework) ───────────
let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(s + '\n'));
function test(name: string, fn: () => void) {
  try { fn(); passed++; log(`  ok  ${name}`); }
  catch (e) { failed++; log(`FAIL  ${name}: ${(e as Error).message}`); }
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }

// ── event registration + envelope ────────────────────────────────────────────
type PlaceP = { piece: string };
const placeEvent = defineEventType<PlaceP>({
  type: 'test.piece.place',
  undoable: true,
  describe: (p) => `place ${p.piece}`,
});

test('a registered factory stamps a well-formed, not-yet-ordered event', () => {
  const refs: TargetRef[] = [{ kind: 'piece', id: 'wall-1' }, { kind: 'chunk', id: '3,2' }];
  const e = placeEvent({ piece: 'Wall Kit' }, refs);
  assert(e.type === 'test.piece.place', 'type carried');
  assert(e.seq === SEQ_PENDING, 'seq pending until authority assigns');
  assert(e.origin === peerId(), 'origin stamped with current peer');
  assert(typeof e.ts === 'number' && e.ts > 0, 'ts stamped');
  assert(e.targets.length === 2, 'targets carried');
  assert(e.payload.piece === 'Wall Kit', 'payload carried');
});

test('migrated command correlation lives in the durable envelope', () => {
  const e = placeEvent({ piece: 'Wall Kit' }, [{ kind: 'piece', id: 'wall-2' }], {
    invocationId: 'invoke:2',
    commandId: 'world.pieces.place',
    actionId: 'action:2',
    source: 'viewport',
    phase: 'applied',
    effect: 'action',
    undoScope: { kind: 'document', key: 'world' },
  });
  assert(e.invocationId === 'invoke:2' && e.commandId === 'world.pieces.place', 'command identity carried');
  assert(e.actionId === 'action:2' && e.phase === 'applied', 'action correlation carried');
  assert(e.source === 'viewport' && e.undoScope?.key === 'world', 'source and undo scope carried');
});

test('re-registering a type is rejected (the anti-collision seam)', () => {
  let threw = false;
  try { defineEventType({ type: 'test.piece.place', undoable: false, describe: () => '' }); }
  catch { threw = true; }
  assert(threw, 'duplicate type registration must throw');
});

test('the registry can describe an envelope read back without its factory', () => {
  assert(eventTypeDef('test.piece.place')?.undoable === true, 'def looked up by type');
  const label = describeEvent({ seq: 5, origin: 'x', ts: 1, type: 'test.piece.place', targets: [], payload: { piece: 'Door' } });
  assert(label === 'place Door', `described via registry, got "${label}"`);
  assert(registeredEventTypes().includes('test.piece.place'), 'type listed for settings UIs');
});

test('peer id is settable for multiplayer ordering and defaults to local', () => {
  const before = placeEvent({ piece: 'a' });
  assert(before.origin === 'local', 'defaults to local');
  setPeerId('peer-7');
  const after = placeEvent({ piece: 'b' });
  assert(after.origin === 'peer-7', 'origin follows the set peer id');
  setPeerId('local');
});

// ── local-fallback bus ordering ──────────────────────────────────────────────
test('dispatch assigns a monotonic seq and the log replays in order', () => {
  assert(!isHostBacked(), 'no Zig door in a bare v8cli run → local fallback');
  const base = head();
  const got: number[] = [];
  const off = onEvent((e) => got.push(e.seq));
  const s1 = dispatch(placeEvent({ piece: 'one' }));
  const s2 = dispatch(placeEvent({ piece: 'two' }));
  off();
  assert(s2 === s1 + 1, 'seq is monotonic +1');
  assert(head() === base + 2, 'head advanced by two');
  const tail = since(base);
  assert(tail.length === 2 && tail[0]!.seq < tail[1]!.seq, 'since() replays oldest-first in order');
  assert(got.length === 2 && got[0] === s1 && got[1] === s2, 'subscribers saw confirmed seqs');
});

// ── diagnostics channel branch ───────────────────────────────────────────────
test('a disabled channel is a cheap branch; toggling flips it', () => {
  const ch = defineChannel({
    id: 'test.diag.place', label: 'Place', description: 'placement timing',
    costTier: 'sampled', defaultOn: false, sinks: ['console', 'bus'],
  });
  assert(ch.on === false, 'defaultOn false → starts disabled');
  ch.log('info', 'should be a no-op while disabled'); // must not throw with no host
  setChannelEnabled('test.diag.place', true);
  assert(ch.on === true && isChannelEnabled('test.diag.place'), 'toggle enables');
  assert(registeredChannels().some((c) => c.id === 'test.diag.place'), 'channel listed for the toggle menu');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) (globalThis as any).__exit?.(1);
