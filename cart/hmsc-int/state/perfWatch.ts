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
  // Outside-render attribution, measured host-side at real boundaries (see
  // framework/v8_gc_shim.cpp, gpu.zig present timing, v8_runtime bridge timing).
  // These let the classifier name the ONE cause instead of guessing GC/native.
  gcNs: number; // V8 GC wall-time this frame in NANOSECONDS (sub-µs honest)
  gcCount: number; // GC invocations this frame — 0 means the GC never fired (vs tiny)
  gcType: number; // GCType bitmask: 1 scavenge, 2 minor-ms, 4 mark-sweep, 8 incremental, 16 weak
  presentUs: number; // vsync/present wait — a subset of gpuUs
  bridgeUs: number; // Zig→JS crossings (app tick + events) — lives in `other`
};

function frameRecordFrom(f: any): FrameRecord {
  return {
    fps: Number(f.fps) || 0,
    tickUs: Number(f.tick_us) || 0,
    layoutUs: Number(f.layout_us) || 0,
    paintUs: Number(f.paint_us) || 0,
    gpuUs: Number(f.gpu_us) || 0,
    totalUs: Number(f.frame_total_us) || 0,
    frameNumber: Number(f.frame_number) || 0,
    gcNs: Number(f.gc_ns) || 0,
    gcCount: Number(f.gc_count) || 0,
    gcType: Number(f.gc_type) || 0,
    presentUs: Number(f.present_us) || 0,
    bridgeUs: Number(f.bridge_us) || 0,
  };
}

export function readFrameRecord(): FrameRecord | null {
  const fn = hostFn('__tel_frame');
  if (!fn) return null;
  try {
    const f = fn();
    if (!f) return null;
    return frameRecordFrom(f);
  } catch {
    return null;
  }
}

// GAP-2: read the FULL frame record for history depth n (0 = current, newest
// first — same indexing as __tel_history). Lets flush() pull the SPIKE frame's
// latched buckets instead of the recovered current frame. null past the ring or
// when the host fn isn't registered (older host → caller falls back to current).
function readFrameRecordAt(n: number): FrameRecord | null {
  const fn = hostFn('__tel_frame_at');
  if (!fn) return null;
  try {
    const f = fn(n);
    if (!f) return null;
    return frameRecordFrom(f);
  } catch {
    return null;
  }
}

// GAP-2: find the LATCHED snapshot of the worst frame, matched by its total time
// rather than a raw ring index. The host ring (per-frame buckets) advances a few
// frames between when the tape was sampled and now (host ~240Hz, JS tick ~60Hz),
// so an index would drift. The worst frame's total_us is a fingerprint that's
// still in the ring (120 frames ≈ 0.5s; flush runs within ~16ms), so we scan and
// match it — that frame's gc/present/bridge are exactly what fired during it.
// Returns null when the host fn is absent (older host) → caller uses current.
function findSpikeFrameRecord(worstUs: number, depth: number): FrameRecord | null {
  if (!hostFn('__tel_frame_at')) return null;
  const target = Math.round(worstUs);
  let nearest: FrameRecord | null = null;
  for (let n = 0; n <= depth; n++) {
    const r = readFrameRecordAt(n);
    if (!r) break; // past the ring's filled range
    if (Math.round(r.totalUs) === target) return r; // exact spike frame
    if (!nearest || r.totalUs > nearest.totalUs) nearest = r; // best-effort fallback
  }
  return nearest;
}

// Flat snapshot of the counters worth diffing across a spike. Everything here
// should be DEAD STILL at idle — any field that moves on the spike frame is a
// candidate cause.
type Counters = Record<string, number>;

export function readCounters(): Counters {
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

// Decode V8's GCType bitmask into the human name. A single GC reports one bit;
// the host records the type of the GC whose pause it timed.
function gcTypeName(t: number): string {
  if (t & 4) return 'mark-sweep'; // kGCTypeMarkSweepCompact — the expensive full GC
  if (t & 8) return 'incremental'; // kGCTypeIncrementalMarking
  if (t & 2) return 'minor mark-sweep'; // kGCTypeMinorMarkSweep
  if (t & 1) return 'scavenge'; // kGCTypeScavenge — cheap young-gen
  if (t & 16) return 'weak-callbacks'; // kGCTypeProcessWeakCallbacks
  return 'unknown';
}

// GC time, kept sub-µs honest: nanoseconds for a tiny scavenge, µs / ms as it
// grows. A floored-to-µs "0us" is the value-ambiguity we are removing.
function formatGcTime(gcNs: number): string {
  if (gcNs >= 1_000_000) return `${(gcNs / 1_000_000).toFixed(2)}ms`;
  if (gcNs >= 1_000) return `${(gcNs / 1_000).toFixed(1)}µs`;
  return `${Math.round(gcNs)}ns`;
}

// The GC bucket label. The count is the disambiguator: "×0, never fired" means
// the binding produced nothing (chase the registration); "×3" means it fired
// and the time — however tiny — is real.
function gcLabel(gcNs: number, gcCount: number, gcType: number): string {
  if (gcCount <= 0) return 'V8 GC — (×0, never fired)';
  return `V8 GC ${formatGcTime(gcNs)} (${gcTypeName(gcType)} ×${gcCount})`;
}

// Name the single largest measured contributor to the outside-render ("other")
// time. No guessing: GC is measured at V8's callbacks, bridge at the Zig→JS
// boundary, and whatever neither covers is reported as its own explicit
// UNATTRIBUTED bucket (genuinely native: terminal/PTY/physics/scheduling).
function attributeOutside(gcNs: number, gcCount: number, gcType: number, bridgeUs: number, unattributedUs: number): string {
  const gcUs = gcNs / 1000;
  const candidates: Array<[string, number]> = [
    [gcLabel(gcNs, gcCount, gcType), gcUs],
    [`NATIVE BRIDGE ${us(bridgeUs)} — Zig→JS app tick / event dispatch`, bridgeUs],
    [`UNATTRIBUTED ${us(unattributedUs)} — native (terminal/PTY/physics/scheduling); not GC, not bridge, not present`, unattributedUs],
  ];
  candidates.sort((a, b) => b[1] - a[1]);
  const [label, val] = candidates[0];
  if (val <= 0) {
    // Everything measured read ~0. Still distinguish "GC fired but tiny" from
    // "GC never fired" so the reader knows the binding is alive.
    const gcNote = gcCount > 0 ? ` (GC fired ${formatGcTime(gcNs)} ×${gcCount})` : '';
    return `WHAT FIRED: outside-render time but every boundary timer read ~0 — sub-microsecond scheduling jitter, nothing actionable.${gcNote}`;
  }
  return `WHAT FIRED: ${label}.`;
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
  // Outside-render ("other") time and its MEASURED components. bridgeUs (Zig→JS)
  // is the one measured timer that lives in `other`; GC is frame-wide; present
  // is inside the gpu phase. unattributedUs is whatever the bridge timer doesn't
  // cover — genuinely native (terminal/PTY/physics/scheduling).
  const otherUs = record ? Math.max(0, record.totalUs - (record.tickUs + record.layoutUs + record.paintUs + record.gpuUs)) : 0;
  const gcNs = record?.gcNs ?? 0;
  const gcUs = gcNs / 1000;
  const gcCount = record?.gcCount ?? 0;
  const gcType = record?.gcType ?? 0;
  const presentUs = record?.presentUs ?? 0;
  const bridgeUs = record?.bridgeUs ?? 0;
  const unattributedUs = Math.max(0, otherUs - bridgeUs);
  let dominant = 'unknown';
  if (record) {
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
  // V8 GC is measured frame-wide at the isolate's prologue/epilogue callbacks,
  // so it can inflate ANY phase (a GC during __jsTick lands in `other`; during a
  // reconcile commit it lands in tick). If the measured pause is a big slice of
  // the frame, name it definitively with type — this is the headline the user
  // wanted ("V8 GC 11.3ms (mark-sweep)") instead of guessing.
  if (record && gcCount > 0 && gcUs > 1500 && gcUs >= record.totalUs * 0.4) {
    const pct = ((100 * gcUs) / Math.max(1, record.totalUs)).toFixed(0);
    return `WHAT FIRED: ${gcLabel(gcNs, gcCount, gcType)} — measured at V8's GC prologue/epilogue callbacks; ${pct}% of the frame was this pause.`;
  }
  if (caught && dominant === 'gpu') {
    // present_us is the MEASURED swapchain acquire+present wait (a subset of the
    // gpu phase). If it accounts for most of the gpu phase, the frame was simply
    // vblank-capped (idle), not stalled. Otherwise the gpu time was real
    // encode/upload/draw work.
    const presentDominant = presentUs >= record!.gpuUs * 0.6;
    const computeUs = Math.max(0, record!.gpuUs - presentUs);
    if (presentDominant) {
      return `WHAT FIRED: VSYNC / PRESENT WAIT ${us(presentUs)} — measured wait on swapchain acquire + present (display vblank). Not a stall; the frame was idle-capped at the refresh rate (${computeUs > 0 ? `${us(computeUs)} actual GPU work` : 'no GPU work'}).`;
    }
    return `WHAT FIRED: GPU DRAW/UPLOAD ${us(computeUs)} compute + ${us(presentUs)} present wait${drawSwing ? ` (draw calls ${delta('scene3d_draw_calls') >= 0 ? '+' : ''}${delta('scene3d_draw_calls')})` : ''}.`;
  }
  if (caught && dominant === 'tick') {
    return 'WHAT FIRED: TICK — JS reconcile / game logic dominated this frame, not rendering.';
  }
  if (caught && dominant === 'other') {
    // No more "GC / native / vsync — could be one of three." Each is measured;
    // name the largest, with an explicit UNATTRIBUTED bucket for what's left.
    return attributeOutside(gcNs, gcCount, gcType, bridgeUs, unattributedUs);
  }
  if (hashFlipped) {
    return 'WHAT FIRED: REPAINT — 2D draw data changed (hash flip) with no tree change → full 2D buffer re-upload from an inline-prop / animated-value churn.';
  }
  if (nodeSwing === 0 && glyphSwing === 0 && !hashFlipped) {
    // Nothing in our draw counters moved — but we MEASURED where the time went.
    return attributeOutside(gcNs, gcCount, gcType, bridgeUs, unattributedUs);
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
  // GAP-2: prefer the LATCHED snapshot of the actual worst frame (its buckets
  // are what fired during the spike), falling back to the current frame only
  // when the host can't supply it (older host / rolled off the ring).
  const spikeFrame = findSpikeFrameRecord(worstUs, Math.min(history.length + 8, 120));
  const record = spikeFrame ?? readFrameRecord();
  const latched = spikeFrame != null;
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
    // With the latched frame we KNOW we have the spike frame (matched by total
    // time in the host ring). Without it, we fell back to the recovered current
    // frame and say so. Name the dominant phase either way.
    const dominant = record.paintUs >= record.gpuUs ? 'paint (CPU raster / atlas)' : 'gpu (upload/draw)';
    lines.push(
      latched
        ? `SPIKE FRAME CAUGHT (latched from host ring) — dominant phase: ${dominant}`
        : 'spike already recovered; phases below are the post-spike current frame (host latch unavailable)',
    );
    lines.push(
      `${latched ? 'spike' : 'current'} frame phases: tick ${us(record.tickUs)}  layout ${us(record.layoutUs)}  ` +
        `paint ${us(record.paintUs)}  gpu ${us(record.gpuUs)}  other ${us(other)}  (total ${us(record.totalUs)})`,
    );
    // Outside-render breakdown, each MEASURED at its real boundary (not inferred
    // by subtraction). The buckets sum honestly: bridge + unattributed ≈ other
    // (present is inside the gpu phase, GC is frame-wide and may overlap any).
    const unattributed = Math.max(0, other - record.bridgeUs);
    lines.push(
      `outside-render attribution: ${gcLabel(record.gcNs, record.gcCount, record.gcType)} (frame-wide)  |  ` +
        `present/vsync ${us(record.presentUs)} (within gpu)  |  ` +
        `bridge ${us(record.bridgeUs)} (Zig→JS, within other)  |  ` +
        `unattributed ${us(unattributed)} (native, within other)`,
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
    lines.push('changed across spike: nothing in our draw counters moved — see the outside-render attribution line above for the measured cause (GC / present / bridge / native).');
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

// ── Heartbeat (req_1735) ───────────────────────────────────────────────
// The spike recorder above only fires when a frame is much SLOWER than a calm
// baseline — useless when EVERY frame is already slow (a flat 1-3fps stall has
// no calm baseline to spike against). This is the opposite tool: an
// unconditional once-per-second dump of the current frame's phase breakdown +
// the counters that name what the host is spending the whole frame on. It tells
// you, plainly, whether 1-3fps is paint (CPU raster), gpu (draw/upload), tick
// (JS reconcile), or other (GC/native) — and how big the scene/draw counts are.
let heartbeatStarted = false;

export function startPerfHeartbeat(): () => void {
  if (heartbeatStarted) return () => {};
  // req_1933: OPT-IN only. This once-per-second [hb] dump (a req_1735 TEMP probe) spammed the
  // dev terminal every second and drowned everything — including the edit-latency lines the user
  // is trying to read. Off by default; set globalThis.__perfHeartbeat = 1 (or via gv_perflog) to
  // re-enable when you actually want the frame breakdown.
  if (!(globalThis as any).__perfHeartbeat) return () => {};
  heartbeatStarted = true;
  let stopped = false;
  let handle: any = 0;

  const tick = () => {
    if (stopped) return;
    const r = readFrameRecord();
    const c = readCounters();
    if (r) {
      const known = r.tickUs + r.layoutUs + r.paintUs + r.gpuUs;
      const other = Math.max(0, r.totalUs - known);
      const phases: Array<[string, number]> = [
        ['tick', r.tickUs], ['layout', r.layoutUs], ['paint', r.paintUs], ['gpu', r.gpuUs], ['other', other],
      ];
      const dominant = phases.slice().sort((a, b) => b[1] - a[1])[0][0];
      emitLine(
        `[hb] ~${r.fps ? Math.round(r.fps) : 0}fps  total ${us(r.totalUs)}  DOMINANT=${dominant}  ` +
          `tick ${us(r.tickUs)} layout ${us(r.layoutUs)} paint ${us(r.paintUs)} gpu ${us(r.gpuUs)} other ${us(other)}  ` +
          `| present ${us(r.presentUs)} bridge ${us(r.bridgeUs)} ${gcLabel(r.gcNs, r.gcCount, r.gcType)}  ` +
          `| rects ${c.rect_count ?? '?'} glyphs ${c.glyph_count ?? '?'} atlas ${c.atlas_glyph_count ?? '?'} ` +
          `nodes ${c.total ?? '?'} scene3d{inst ${c.scene3d_instances ?? '?'} draws ${c.scene3d_draw_calls ?? '?'} ` +
          `meshes ${c.scene3d_meshes_collected ?? '?'} dropped ${c.scene3d_meshes_dropped ?? '?'} children ${c.scene3d_mesh_children ?? '?'}}`,
      );
    } else {
      emitLine('[hb] no __tel_frame — telemetry host fn not registered on this build');
    }
    handle = setTimeout(tick, 1000);
  };
  handle = setTimeout(tick, 1000);
  return () => { stopped = true; heartbeatStarted = false; clearTimeout(handle); };
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
