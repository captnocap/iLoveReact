// loop.test.ts — P4 behavior tests for GAME_LOOP.
//
// Asserts the two ruled facts (V8: ~45/min cadence; the rAF-probe transport
// falls back to setTimeout(16) on hosts without rAF) by faking the host's
// schedulers and watching which one the door picks. No loop API exists to
// test — that absence is R3, by design.

import { FALLBACK_FRAME_MS, GAME_LOOP } from './loop';
import { assert, assertClose, assertEqual, finish, test } from './_testkit';

declare const globalThis: any;

test('the state tick is the ruled ~45/min reconciliation cadence (V8)', () => {
  assertEqual(GAME_LOOP.STATE_TICKS_PER_MINUTE, 45, 'cadence must match the V8 ruling');
  assertClose(GAME_LOOP.stateTickIntervalMs(), 60000 / 45, 1e-9, 'interval must derive from the cadence');
});

test('now() ticks forward', () => {
  const a = GAME_LOOP.now();
  let spin = 0;
  for (let i = 0; i < 1e5; i += 1) spin += i;
  const b = GAME_LOOP.now();
  assert(Number.isFinite(a) && Number.isFinite(b), `now() must be numeric (spin=${spin > 0})`);
  assert(b >= a, 'now() must never run backwards');
});

test('without rAF the frame transport falls back to setTimeout(16)', () => {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const scheduled: number[] = [];
  let cleared = 0;
  delete globalThis.requestAnimationFrame;
  delete globalThis.cancelAnimationFrame;
  globalThis.setTimeout = (_fn: () => void, ms: number) => { scheduled.push(ms); return 41; };
  globalThis.clearTimeout = () => { cleared += 1; };
  try {
    const handle = GAME_LOOP.scheduleFrame(() => undefined);
    GAME_LOOP.cancelFrame(handle);
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }
  assertEqual(scheduled.length, 1, 'one frame must be scheduled');
  assertEqual(scheduled[0], FALLBACK_FRAME_MS, 'the fallback must use the 16ms frame interval');
  assertEqual(cleared, 1, 'cancel must reach clearTimeout');
});

test('with rAF the frame transport rides it', () => {
  let rafCalls = 0;
  let cafCalls = 0;
  globalThis.requestAnimationFrame = (_fn: () => void) => { rafCalls += 1; return 7; };
  globalThis.cancelAnimationFrame = (_h: unknown) => { cafCalls += 1; };
  try {
    const handle = GAME_LOOP.scheduleFrame(() => undefined);
    GAME_LOOP.cancelFrame(handle);
  } finally {
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  }
  assertEqual(rafCalls, 1, 'rAF must be preferred when present');
  assertEqual(cafCalls, 1, 'cancel must pair with the rAF path');
});

finish('game/loop');
