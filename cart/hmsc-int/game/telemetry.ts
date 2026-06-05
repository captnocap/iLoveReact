// game/telemetry.ts — GAME_TELEMETRY: the perf panel + copy-diagnostics button
// every lab gets for free (V14). CAPTURE PENDING.
//
// hmsc's perfWatch lineage (gv_perflog) is the behavior reference; the
// hostMicroseconds channel GAME_PHYSICS already returns is this door's first
// feed. Door only, nothing fake.

export const GAME_TELEMETRY = Object.freeze({
  status: 'capture-pending' as const,
});
