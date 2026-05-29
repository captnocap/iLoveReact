// Diagnostic instrumentation to localize idle frame spikes. `timed()` wraps a
// named operation and records how long it took; a frame-cadence watcher flags
// long frames and attributes each to the heaviest op that ran during it — so a
// spike with NO heavy op of ours points at GC / native work (host physics, GPU)
// rather than our JS timers. Pure diagnostics, no gameplay effect; rip out once
// the spike source is settled.

declare const globalThis: any;

type OpSample = { label: string; ms: number; atMs: number };

const RING_MAX = 8;
const NOTABLE_MS = 1.5; // only ring-log ops at least this slow (skip cheap ticks)
const SLOW_FRAME_MS = 14; // a frame longer than this is a spike (~under 72fps)
const ROLLING_WINDOW_MS = 1000;

const recentNotable: OpSample[] = [];
let frameOps: OpSample[] = []; // ops since the last frame tick, for spike attribution
const slowFrames: { atMs: number; gapMs: number }[] = [];
let lastSpikeDuring = '';
let monitorStarted = false;

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

// Wrap any operation to time it. Always recorded for per-frame spike
// attribution; only kept in the visible ring if it's actually slow.
export function timed<T>(label: string, fn: () => T): T {
  const start = now();
  try {
    return fn();
  } finally {
    const sample = { label, ms: now() - start, atMs: now() };
    frameOps.push(sample);
    if (sample.ms >= NOTABLE_MS) {
      recentNotable.push(sample);
      if (recentNotable.length > RING_MAX) recentNotable.shift();
    }
  }
}

// Start the frame watcher (idempotent). Uses the same rAF-or-setTimeout cadence
// the rest of the cart uses; a main-thread stall delays the callback either way,
// so the measured gap still captures GC/native hitches.
export function startPerfMonitor(): () => void {
  if (monitorStarted) return () => {};
  monitorStarted = true;
  const schedule = globalThis.requestAnimationFrame
    ? globalThis.requestAnimationFrame.bind(globalThis)
    : (fn: any) => setTimeout(fn, 16);
  const cancel = globalThis.cancelAnimationFrame
    ? globalThis.cancelAnimationFrame.bind(globalThis)
    : clearTimeout;
  let handle: any = 0;
  let last = now();

  const tick = () => {
    const t = now();
    const gapMs = t - last;
    last = t;
    if (gapMs > SLOW_FRAME_MS) {
      slowFrames.push({ atMs: t, gapMs });
      let heaviest: OpSample | null = null;
      for (const op of frameOps) {
        if (!heaviest || op.ms > heaviest.ms) heaviest = op;
      }
      lastSpikeDuring = heaviest && heaviest.ms >= NOTABLE_MS
        ? `${heaviest.label} ${heaviest.ms.toFixed(1)}ms`
        : 'none (gc/native?)';
    }
    frameOps = [];
    const cutoff = t - ROLLING_WINDOW_MS;
    while (slowFrames.length && slowFrames[0].atMs < cutoff) slowFrames.shift();
    handle = schedule(tick);
  };

  handle = schedule(tick);
  return () => {
    cancel(handle);
    monitorStarted = false;
  };
}

export type PerfSnapshot = {
  worstGapMs: number;
  slowFramesPerSec: number;
  lastSpikeDuring: string;
  recentNotable: OpSample[];
};

export function perfSnapshot(): PerfSnapshot {
  let worstGapMs = 0;
  for (const frame of slowFrames) if (frame.gapMs > worstGapMs) worstGapMs = frame.gapMs;
  return {
    worstGapMs,
    slowFramesPerSec: slowFrames.length,
    lastSpikeDuring,
    recentNotable: recentNotable.slice().reverse(),
  };
}
