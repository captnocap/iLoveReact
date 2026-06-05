// game/loop.ts — GAME_LOOP: clocks only, deliberately MINIMAL.
//
// R3 (DECISIONS resolutions): the render-loop hook is ruled BY A LAB — "this
// is what labs are for". Until the loop-shapes lab rules, NO loop API lives
// here, so nothing is preempted. What IS ruled (V8/V8-CLARIFIED) and therefore
// allowed in this file:
//
//   - TWO CLOCKS: the frame loop and the game-state tick are distinct.
//   - The state tick is a RECONCILIATION cadence, ~45/min — strategic
//     check-ins that drain scheduled invalidations; player actions force
//     immediate ticks; frames are the other clock entirely.
//
// So this door carries: the ruled cadence, a monotonic clock, and raw frame
// scheduling transport (the host has no requestAnimationFrame — the corpus's
// unanimous rAF-probe/setTimeout idiom, as plumbing, not as a loop shape).

declare const globalThis: any;

/** V8-ruled state-tick cadence. Surfaces in data/tuning when V20 lands (P2). */
export const STATE_TICKS_PER_MINUTE = 45;

/** The ruled cadence as a tick interval (≈1333ms — the ~1.3s staleness bound). */
export function stateTickIntervalMs(): number {
  return 60_000 / STATE_TICKS_PER_MINUTE;
}

/** Fallback frame interval when the host has no rAF (the ~60Hz idiom). */
export const FALLBACK_FRAME_MS = 16;

/** Monotonic-ish milliseconds: performance.now when the host has it. */
export function now(): number {
  const perf = globalThis.performance;
  return typeof perf?.now === 'function' ? perf.now() : Date.now();
}

export type FrameHandle = unknown;

/** Schedule one frame callback: rAF when the host has it, setTimeout(16) otherwise. */
export function scheduleFrame(fn: () => void): FrameHandle {
  const raf = globalThis.requestAnimationFrame;
  if (typeof raf === 'function') return raf(fn);
  return globalThis.setTimeout(fn, FALLBACK_FRAME_MS);
}

/** Cancel a scheduled frame callback (pairs with scheduleFrame's probe). */
export function cancelFrame(handle: FrameHandle): void {
  const caf = globalThis.cancelAnimationFrame;
  if (typeof caf === 'function') caf(handle);
  else globalThis.clearTimeout(handle);
}

export const GAME_LOOP = Object.freeze({
  STATE_TICKS_PER_MINUTE,
  stateTickIntervalMs,
  FALLBACK_FRAME_MS,
  now,
  scheduleFrame,
  cancelFrame,
});
