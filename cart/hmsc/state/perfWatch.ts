// Spike-triggered diagnostic flight recorder for the idle-frame stutter hunt.
//
// The symptom: at idle the cart sits at ~240fps and then randomly dips to
// ~190fps with no obvious cause. fps is a 1-second average, so by the time you
// SEE the dip the frame that caused it is long gone. This module flips that
// around — it watches the host's per-frame timing ring every JS tick and, the
// moment a frame runs much slower than the calm baseline, it FLUSHES a full
// diagnostic block to the console (which routes to the dev terminal via
// __hostLog). You don't have to catch the spike with your eyes; the spike
// catches itself and prints what coincided with it.
//
// Why this finds the bug: at true idle nothing should change frame to frame.
// So whatever counter MOVED across the spike boundary is the smoking gun —
// frame_hash flipping means the 2D draw data changed and the GPU buffer got
// re-uploaded (the classic StaticSurface inline-prop rebake, see the cart's
// tileSurface notes); a jump in nodes/rects/glyphs means a React commit fired;
// a gpu_us balloon with no draw-data change points at GPU/native work. The
// flush prints the calm-vs-spike delta of all of these so the cause names
// itself.
//
// Pure diagnostics. No gameplay effect. Toggle with `gv_perflog` in the
// console; rip the whole module out once the spike source is settled.

declare const globalThis: any;

// ── Tunables ───────────────────────────────────────────────────────────
export type PerfWatchConfig = {
  // A host frame counts as a spike when its total time is BOTH this many times
  // the calm baseline AND at least this many microseconds slower than it. Two
  // gates so we ignore both proportional jitter on fast frames and tiny
  // absolute wobble on slow ones.
  spikeRatio: number;
  minJumpUs: number;
  // Don't flush more than one report per this window — a spike that lasts
  // several frames, or a burst of them, is one event to a human reader.
  cooldownMs: number;
  // How many recent frame times to print as the trailing flight-recorder tape.
  recorderFrames: number;
};

const DEFAULT_CONFIG: PerfWatchConfig = {
  // 1.15 catches the canonical 240→190fps dip (4.17ms→5.26ms ≈ 1.26x) with
  // margin while still ignoring frame-to-frame jitter. The minJump gate stops
  // it firing on fast frames where a small absolute wobble looks like a big
  // ratio.
  spikeRatio: 1.15,
  minJumpUs: 500,
  cooldownMs: 400,
  recorderFrames: 48,
};

let config: PerfWatchConfig = { ...DEFAULT_CONFIG };

// ── Host access ────────────────────────────────────────────────────────
function now(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function hostFn(name: string): ((...args: any[]) => any) | null {
  const fn = globalThis[name];
  return typeof fn === 'function' ? fn : null;
}

// __tel_history(n) → array of the last n frame_total_us values, newest first
// (host-side ring, up to 120). This is the key to not missing single-frame
// spikes: even though this JS loop only ticks ~60x/sec, every host frame lands
// in this ring, and at 240fps 120 frames is half a second of cushion.
function readFrameHistory(n: number): number[] {
  const fn = hostFn('__tel_history');
  if (!fn) return [];
  try {
    const arr = fn(n);
    if (!Array.isArray(arr)) return [];
    const out: number[] = [];
    for (const v of arr) {
      const num = Number(v);
      if (Number.isFinite(num) && num > 0) out.push(num);
    }
    return out;
  } catch {
    return [];
  }
}

type FrameRecord = {
  fps: number;
  tickUs: number;
  layoutUs: number;
  paintUs: number;
  gpuUs: number;
  totalUs: number;
  frameNumber: number;
};

function readFrameRecord(): FrameRecord | null {
  const fn = hostFn('__tel_frame');
  if (!fn) return null;
  try {
    const f = fn();
    if (!f) return null;
    return {
      fps: Number(f.fps) || 0,
      tickUs: Number(f.tick_us) || 0,
      layoutUs: Number(f.layout_us) || 0,
      paintUs: Number(f.paint_us) || 0,
      gpuUs: Number(f.gpu_us) || 0,
      totalUs: Number(f.frame_total_us) || 0,
      frameNumber: Number(f.frame_number) || 0,
    };
  } catch {
    return null;
  }
}

// Flat snapshot of the counters worth diffing across a spike. Everything here
// should be DEAD STILL at idle — any field that moves on the spike frame is a
// candidate cause.
type Counters = Record<string, number>;

function readCounters(): Counters {
  const out: Counters = {};
  const pull = (name: string, keys: string[]) => {
    const fn = hostFn(name);
    if (!fn) return;
    try {
      const o = fn();
      if (!o) return;
      for (const k of keys) {
        const v = Number(o[k]);
        if (Number.isFinite(v)) out[k] = v;
      }
    } catch {
      /* leave missing */
    }
  };
  pull('__tel_gpu', [
    'frame_hash',
    'rect_count',
    'glyph_count',
    'glyph_capacity',
    // Atlas counters: a paint-dominated spike that re-rasterizes the whole font
    // atlas shows up as atlas_glyph_count resetting/jumping here. This is the
    // tell for "37ms paint = atlas rebuild" vs "draw data just re-uploaded".
    'atlas_glyph_count',
    'atlas_capacity',
    'frames_since_drain',
    'scene3d_instances',
    'scene3d_draw_calls',
    'scene3d_meshes_collected',
    'scene3d_meshes_dropped',
    'scene3d_mesh_children',
  ]);
  // zero_size omitted on purpose — the host counter reads cumulative/garbage
  // (oscillates far above `total`), so its delta is pure noise in the report.
  pull('__tel_nodes', ['total', 'visible', 'hidden']);
  pull('__tel_input', ['active_count', 'type_count']);
  return out;
}

// ── Math helpers ───────────────────────────────────────────────────────
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function us(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(2)}ms` : `${value.toFixed(0)}us`;
}

// ── Classify ─────────────────────────────────────────────────────────────
// Turn the phase breakdown + counter deltas into ONE plain-English verdict of
// what kind of event the spike was, so the report names the cause instead of
// leaving the reader to decode raw counters. Ordered most-specific first; it's
// a heuristic, so the raw phases + deltas still print below for confirmation.
function classifySpike(record: FrameRecord | null, calm: Counters, spike: Counters): string {
  const delta = (key: string): number => {
    const before = calm[key];
    const after = spike[key];
    return before == null || after == null ? 0 : after - before;
  };
  const hashFlipped = calm.frame_hash != null && spike.frame_hash != null && calm.frame_hash !== spike.frame_hash;
  const atlasGrew = delta('atlas_glyph_count');
  const nodeSwing = Math.max(Math.abs(delta('total')), Math.abs(delta('visible')));
  const glyphSwing = Math.abs(delta('glyph_count'));
  const meshSwing = Math.max(Math.abs(delta('scene3d_meshes_collected')), Math.abs(delta('scene3d_instances')));
  const drawSwing = Math.abs(delta('scene3d_draw_calls'));

  // Phase dominance is only trustworthy when __tel_frame actually carries the
  // spike frame (not a recovered post-spike read).
  const caught = record != null && record.totalUs > baselineForCaught(record);
  let dominant = 'unknown';
  if (record) {
    const otherUs = Math.max(0, record.totalUs - (record.tickUs + record.layoutUs + record.paintUs + record.gpuUs));
    const phases: Array<[string, number]> = [
      ['paint', record.paintUs], ['gpu', record.gpuUs], ['tick', record.tickUs],
      ['layout', record.layoutUs], ['other', otherUs],
    ];
    dominant = phases.sort((a, b) => b[1] - a[1])[0][0];
  }

  // A big node/glyph/mesh swing = a React commit mounted/unmounted a subtree.
  // This dominates even when the atlas also grew (the new subtree's text raster
  // is a side effect of the swap, not the headline).
  if (nodeSwing >= 20 || glyphSwing >= 50 || meshSwing >= 12) {
    return `WHAT FIRED: CONTENT SWAP — a React commit changed ~${nodeSwing} nodes / ${glyphSwing} glyphs / ${meshSwing} meshes. Something mounted or unmounted; if paint-dominant, that subtree's StaticSurface captures re-baked.`;
  }
  if (atlasGrew >= 5) {
    return `WHAT FIRED: GLYPH RASTERIZE — ${atlasGrew} new glyphs baked into the font atlas (static text re-rendered at a NEW size, or new text content). CPU paint cost.`;
  }
  if (caught && dominant === 'paint') {
    return hashFlipped
      ? 'WHAT FIRED: REPAINT / CAPTURE RE-BAKE — paint-dominant with the 2D hash flipped → a StaticSurface re-rendered its shader and/or the draw buffer re-uploaded.'
      : 'WHAT FIRED: CAPTURE RE-BAKE — heavy CPU paint with NO tree/hash change → a StaticSurface re-rendered its shader (its captured subtree got re-stamped).';
  }
  if (caught && dominant === 'gpu') {
    // The gpu phase is the present/vsync WAIT, not GPU compute. If the CPU
    // phases are tiny, this is just the frame capped at the display refresh
    // (≈16.6ms at 60Hz, ≈4.2ms at 240Hz) — idle, not a stall. Only call it real
    // GPU work when draw calls actually moved.
    const cpuUs = record ? record.tickUs + record.layoutUs + record.paintUs : 0;
    if (cpuUs < 1500 && drawSwing < 3) {
      return 'WHAT FIRED: VSYNC / PRESENT WAIT — gpu-phase = waiting for the display vblank with ~no CPU work. This is the refresh cap (60Hz→16.6ms, 240Hz→4.2ms), not a stall. Expected on a 60Hz monitor.';
    }
    return `WHAT FIRED: GPU DRAW/UPLOAD — gpu-phase bound${drawSwing ? ` (draw calls ${delta('scene3d_draw_calls') >= 0 ? '+' : ''}${delta('scene3d_draw_calls')})` : ''}.`;
  }
  if (caught && dominant === 'tick') {
    return 'WHAT FIRED: TICK — JS reconcile / game logic dominated this frame, not rendering.';
  }
  if (caught && dominant === 'other') {
    return 'WHAT FIRED: GC / NATIVE — time outside every render phase (V8 GC, vsync wait, or native bridge). Not our draw tree.';
  }
  if (hashFlipped) {
    return 'WHAT FIRED: REPAINT — 2D draw data changed (hash flip) with no tree change → full 2D buffer re-upload from an inline-prop / animated-value churn.';
  }
  if (nodeSwing === 0 && glyphSwing === 0 && !hashFlipped) {
    return 'WHAT FIRED: GC / NATIVE — nothing in our counters moved → V8 GC / native / driver hitch, not our JS or draw tree.';
  }
  return 'WHAT FIRED: UNCLEAR — spike likely already recovered; trust the deltas below over the phase line.';
}

// The "caught the actual spike frame" gate, kept in sync with flush()'s 1.5x.
function baselineForCaught(record: FrameRecord): number {
  return record.fps > 0 ? (1_000_000 / record.fps) * 1.5 : 0;
}

// ── Flush ──────────────────────────────────────────────────────────────
// One spike → one multi-line report on the console. The shape is built to be
// scanned top-to-bottom: what fired, how bad, which phase, what moved, the tape.
function flush(history: number[], baselineUs: number, worstUs: number, calm: Counters): void {
  const record = readFrameRecord();
  const spikeCounters = readCounters();

  const lines: string[] = [];
  lines.push('──────── HMSC PERF SPIKE ────────');
  lines.push(classifySpike(record, calm, spikeCounters));
  lines.push(
    `worst ${us(worstUs)}  baseline ${us(baselineUs)}  (+${us(worstUs - baselineUs)}, ${(worstUs / baselineUs).toFixed(2)}x)` +
      `  ~${baselineUs > 0 ? Math.round(1_000_000 / baselineUs) : 0}fps → ~${worstUs > 0 ? Math.round(1_000_000 / worstUs) : 0}fps`,
  );

  if (record) {
    const known = record.tickUs + record.layoutUs + record.paintUs + record.gpuUs;
    const other = Math.max(0, record.totalUs - known);
    // Is `record` actually the spike frame, or did we read after it recovered?
    // __tel_frame only carries the latest frame, so label which we caught and,
    // when caught, name the dominant phase (paint = CPU raster / atlas rebuild;
    // gpu = buffer upload/draw).
    const caughtSpike = record.totalUs > baselineUs * 1.5;
    const dominant = record.paintUs >= record.gpuUs ? 'paint (CPU raster / atlas)' : 'gpu (upload/draw)';
    lines.push(
      caughtSpike
        ? `SPIKE FRAME CAUGHT — dominant phase: ${dominant}`
        : 'spike already recovered; phases below are a post-spike frame (worst frame came from the tape)',
    );
    lines.push(
      `latest frame phases: tick ${us(record.tickUs)}  layout ${us(record.layoutUs)}  ` +
        `paint ${us(record.paintUs)}  gpu ${us(record.gpuUs)}  other ${us(other)}  (total ${us(record.totalUs)})`,
    );
  }

  // Counter deltas — the diagnostic payload. Only print what actually changed.
  const moved: string[] = [];
  const keys = new Set<string>([...Object.keys(calm), ...Object.keys(spikeCounters)]);
  for (const key of keys) {
    const before = calm[key];
    const after = spikeCounters[key];
    if (before === after) continue;
    if (before == null || after == null) continue;
    const delta = after - before;
    const sign = delta > 0 ? '+' : '';
    moved.push(`${key} ${before}→${after} (${sign}${delta})`);
  }
  if (moved.length > 0) {
    lines.push(`changed across spike: ${moved.join('  |  ')}`);
    if (calm.frame_hash != null && spikeCounters.frame_hash != null && calm.frame_hash !== spikeCounters.frame_hash) {
      lines.push('  ^ frame_hash flipped → 2D draw data changed → full GPU re-upload (a React commit / StaticSurface rebake landed this frame).');
    }
  } else {
    lines.push('changed across spike: nothing in our counters moved → GC / native / GPU-driver hitch, not our JS or draw tree.');
  }

  // Flight-recorder tape: recent frame times newest-first, in ms, so the shape
  // of the dip is visible (one fat frame vs a sustained sag).
  const tape = history.slice(0, config.recorderFrames).map((v) => (v / 1000).toFixed(1)).join(' ');
  lines.push(`tape (ms, newest first): ${tape}`);
  lines.push('─────────────────────────────────');

  emitLine(lines.join('\n'));
}

// ── Monitor ────────────────────────────────────────────────────────────
let monitorStarted = false;
let lastFlushAt = 0;
let calmCounters: Counters = {};

// console.log (severity 0) only lands in an in-memory ring — it never reaches a
// terminal. Only warn/error (severity >= 1) write to stderr. So every line this
// module wants you to SEE goes through console.warn.
function emitLine(text: string): void {
  globalThis.console?.warn?.(text);
}

// Idempotent. Returns a stop fn. This host has no requestAnimationFrame (game
// loops crash on it), so we ride the setTimeout fallback at ~60Hz — fine,
// because __tel_history carries every host frame between our ticks.
export function startPerfWatch(): () => void {
  if (monitorStarted) return () => {};
  monitorStarted = true;
  lastFlushAt = 0;
  calmCounters = readCounters();

  const sched = hostFn('requestAnimationFrame');
  const schedule = sched ? sched.bind(globalThis) : (fn: any) => setTimeout(fn, 16);
  const cancelRaf = hostFn('cancelAnimationFrame');
  const cancel = cancelRaf ? cancelRaf.bind(globalThis) : clearTimeout;
  let handle: any = 0;
  let stopped = false;
  let armed = false;

  const tick = () => {
    if (stopped) return;
    const history = readFrameHistory(120);
    if (history.length >= 4) {
      const baseline = median(history);
      let worst = 0;
      for (const v of history) if (v > worst) worst = v;
      // One-shot heartbeat: confirms the recorder is sampling AND that warn-
      // level logs actually reach this terminal. If you never see this line,
      // either telemetry isn't wired or you're watching the wrong terminal.
      if (!armed) {
        armed = true;
        emitLine(
          `[perfwatch] armed — baseline ~${us(baseline)} (~${baseline > 0 ? Math.round(1_000_000 / baseline) : 0}fps). ` +
            `Will flush on frames > ${config.spikeRatio}x baseline. Go idle and wait for HMSC PERF SPIKE.`,
        );
      }
      const isSpike = baseline > 0 && worst > baseline * config.spikeRatio && worst - baseline > config.minJumpUs;
      const t = now();
      if (isSpike) {
        if (t - lastFlushAt > config.cooldownMs) {
          flush(history, baseline, worst, calmCounters);
          lastFlushAt = t;
        }
      } else {
        // Calm tick: keep a fresh pre-spike counter snapshot to diff against.
        calmCounters = readCounters();
      }
    }
    handle = schedule(tick);
  };

  handle = schedule(tick);
  return () => {
    stopped = true;
    monitorStarted = false;
    cancel(handle);
  };
}

// Live-tune the detector from the console without a rebuild.
export function configurePerfWatch(patch: Partial<PerfWatchConfig>): PerfWatchConfig {
  config = { ...config, ...patch };
  return config;
}

export function perfWatchConfig(): PerfWatchConfig {
  return { ...config };
}

export function perfWatchStatusLine(enabled: boolean): string {
  return (
    `perflog = ${enabled ? '1' : '0'}  ` +
    `spikeRatio ${config.spikeRatio}  minJump ${(config.minJumpUs / 1000).toFixed(2)}ms  ` +
    `cooldown ${config.cooldownMs}ms  tape ${config.recorderFrames}`
  );
}
