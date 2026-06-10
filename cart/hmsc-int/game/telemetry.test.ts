// telemetry.test.ts — P4 meaning-tests for GAME_TELEMETRY.
//
// The host fns don't exist under v8cli, which is exactly the point: half the
// suite proves the HONESTY rule (missing host fns degrade loudly via
// availability(), reads return their honest fallbacks), the other half stubs
// the `__tel_*` wire on globalThis (the same dispatch callHost uses) and
// pins the measurement semantics: kind→fn mapping, snake_case normalization,
// ring sanitation, the two-gate spike detector, the WHAT-FIRED verdict tree,
// the report shape, and the copy-diagnostics transport.

import {
  GAME_TELEMETRY,
  TELEMETRY_TUNING,
  type Counters,
  type FrameRecord,
} from './telemetry';
import { assert, assertClose, assertEqual, finish, test, withHost } from './_testkit';

// ── wire stubs (withHost — the shared _testkit idiom) ────────────────────────

const FULL_WIRE: Record<string, unknown> = {
  getFps: () => 240,
  getLayoutUs: () => 120,
  getPaintUs: () => 800,
  getTickUs: () => 300,
  __tel_node_count: () => 41,
  __tel_frame: () => ({
    fps: 240,
    tick_us: 300,
    layout_us: 120,
    paint_us: 800,
    gpu_us: 2900,
    frame_total_us: 4200,
    event_us: 11,
    app_tick_us: 140,
    pre_paint_us: 230,
    post_frame_us: 17,
    gc_ns: 700,
    gc_count: 3,
    gc_type: 1,
    present_us: 1900,
    bridge_us: 140,
    frame_number: 9001,
  }),
  // history depth n → a frame snapshot; depth 2 is the worst (8000us) so the
  // latch-by-total-time path has a distinct frame to find.
  __tel_frame_at: (n: number) => ({
    fps: 240,
    tick_us: 300,
    layout_us: 120,
    paint_us: 800,
    gpu_us: 2900,
    frame_total_us: n === 2 ? 8000 : 4200,
    event_us: 11,
    app_tick_us: 140,
    pre_paint_us: 230,
    post_frame_us: 17,
    gc_ns: n === 2 ? 6_500_000 : 700,
    gc_count: n === 2 ? 1 : 3,
    gc_type: n === 2 ? 4 : 1,
    present_us: 1900,
    bridge_us: 140,
    frame_number: 9001 - n,
  }),
  __tel_host_flush: () => ({
    queued_batches: 0,
    queued_bytes: 0,
    last_drain_batches: 2,
    last_drain_bytes: 4096,
    last_drain_us: 250,
    total_enqueued_batches: 9,
    total_enqueued_bytes: 8192,
    total_drained_batches: 9,
    total_drained_bytes: 8192,
  }),
  __tel_gpu: () => ({
    frame_hash: 7,
    rect_hash: 11,
    text_hash: 13,
    curves_hash: 17,
    capsules_hash: 19,
    polys_hash: 23,
    rect_count: 64,
    glyph_count: 210,
    atlas_miss_count: 7,
    zero_size: 999999,
    junk: 'no',
  }),
  __tel_nodes: () => ({ total: 41, visible: 38, hidden: 3 }),
  __tel_input: () => ({ active_count: 2, type_count: 5 }),
  __tel_history: (n: number) => Array.from({ length: Math.min(n, 8) }, () => 4200),
  __clipboard_set: () => undefined,
};

// ── honesty: the unwired host degrades loudly, never silently ───────────────

test('availability() names every missing host fn instead of degrading silently', () => {
  const bare = GAME_TELEMETRY.availability();
  assertEqual(bare.complete, false, 'v8cli has no telemetry wire — must not claim complete');
  assert(bare.missing.includes('getFps'), 'missing must name the fps scalar fn');
  assert(bare.missing.includes('__tel_frame'), 'missing must name the frame snapshot fn');
  assert(bare.missing.includes('__tel_host_flush'), 'missing must name the host-flush snapshot fn');
  assert(bare.missing.includes('__tel_history'), 'missing must name the history ring fn');
  assert(bare.missing.includes('__clipboard_set'), 'missing must name the clipboard fn');
  withHost(FULL_WIRE, () => {
    const wired = GAME_TELEMETRY.availability();
    assertEqual(wired.complete, true, 'with the full wire stubbed, availability must read complete');
    assertEqual(wired.missing.length, 0, 'nothing may be reported missing when everything is wired');
  });
});

test('unwired reads return their honest fallbacks (0 / null / [])', () => {
  assertEqual(GAME_TELEMETRY.readScalar('fps'), 0, 'scalar without a wire must read 0');
  assertEqual(GAME_TELEMETRY.readFrame(), null, 'frame without a wire must read null');
  assertEqual(GAME_TELEMETRY.readSnapshot('gpu'), null, 'snapshot without a wire must read null');
  assertEqual(GAME_TELEMETRY.readFrameHistory().length, 0, 'history without a wire must be empty');
  assertEqual(Object.keys(GAME_TELEMETRY.readCounters()).length, 0, 'counters without a wire must be empty');
});

// ── the measurement reads ────────────────────────────────────────────────────

test('readScalar maps each kind to its host fn (the legacy getX names included)', () => {
  withHost(FULL_WIRE, () => {
    assertEqual(GAME_TELEMETRY.readScalar('fps'), 240, 'fps → getFps');
    assertEqual(GAME_TELEMETRY.readScalar('layoutUs'), 120, 'layoutUs → getLayoutUs');
    assertEqual(GAME_TELEMETRY.readScalar('paintUs'), 800, 'paintUs → getPaintUs');
    assertEqual(GAME_TELEMETRY.readScalar('tickUs'), 300, 'tickUs → getTickUs');
    assertEqual(GAME_TELEMETRY.readScalar('nodeCount'), 41, 'nodeCount → __tel_node_count');
  });
});

test('readFrame normalizes the wire snake_case into the FrameRecord vocabulary', () => {
  withHost(FULL_WIRE, () => {
    const frame = GAME_TELEMETRY.readFrame();
    assert(frame != null, 'frame must read');
    assertEqual(frame!.totalUs, 4200, 'frame_total_us → totalUs');
    assertEqual(frame!.gpuUs, 2900, 'gpu_us → gpuUs');
    assertEqual(frame!.eventUs, 11, 'event_us → eventUs');
    assertEqual(frame!.appTickUs, 140, 'app_tick_us → appTickUs');
    assertEqual(frame!.prePaintUs, 230, 'pre_paint_us → prePaintUs');
    assertEqual(frame!.postFrameUs, 17, 'post_frame_us → postFrameUs');
    assertEqual(frame!.gcNs, 700, 'gc_ns → gcNs (nanoseconds, sub-µs honest)');
    assertEqual(frame!.gcCount, 3, 'gc_count → gcCount (invocation count)');
    assertEqual(frame!.presentUs, 1900, 'present_us → presentUs');
    assertEqual(frame!.bridgeUs, 140, 'bridge_us → bridgeUs');
    assertEqual(frame!.frameNumber, 9001, 'frame_number → frameNumber');
  });
});

test('readFrameAt + findSpikeFrameRecord latch the worst frame by its total time, not a stale index', () => {
  withHost(FULL_WIRE, () => {
    const at0 = GAME_TELEMETRY.readFrameAt(0);
    assert(at0 != null && at0!.totalUs === 4200, 'depth 0 is the current frame');
    // The worst frame (8000us) is at depth 2 — matched by total time even though
    // the ring may have drifted since the tape was sampled.
    const spike = GAME_TELEMETRY.findSpikeFrameRecord(8000, 8);
    assert(spike != null, 'the worst frame is found in the ring');
    assertEqual(spike!.totalUs, 8000, 'matched by total time, not index 0');
    assertEqual(spike!.gcNs, 6_500_000, 'the LATCHED spike frame carries ITS buckets, not the current frame');
  });
});

test('readFrameAt is null when the host fn is absent (older host falls back to current frame)', () => {
  withHost({ ...FULL_WIRE, __tel_frame_at: undefined }, () => {
    assertEqual(GAME_TELEMETRY.readFrameAt(0), null, 'no __tel_frame_at → null, never throws');
    assertEqual(GAME_TELEMETRY.findSpikeFrameRecord(8000, 8), null, 'no host fn → null, caller uses current frame');
  });
});

test('hostFlush snapshot exposes queued React drain cost as data, not terminal probes', () => {
  withHost(FULL_WIRE, () => {
    const flush = GAME_TELEMETRY.readSnapshot('hostFlush');
    assert(flush != null, 'host-flush snapshot must read');
    assertEqual(Number(flush!.last_drain_us), 250, 'last_drain_us must survive as the measured drain cost');
    assertEqual(Number(flush!.last_drain_batches), 2, 'last_drain_batches must identify batch count');
    assertEqual(Number(flush!.last_drain_bytes), 4096, 'last_drain_bytes must identify payload size');
  });
});

test('readFrameHistory passes n through and filters junk (non-finite, <= 0)', () => {
  let asked = 0;
  withHost(
    { __tel_history: (n: number) => { asked = n; return [4200, 'junk', -5, 0, NaN, 5100]; } },
    () => {
      const ring = GAME_TELEMETRY.readFrameHistory(48);
      assertEqual(asked, 48, 'the requested ring length must reach the host');
      assertEqual(ring.join(','), '4200,5100', 'only finite positive frame times survive');
    },
  );
});

test('readCounters pulls exactly the diffable spec — zero_size stays out (cumulative garbage)', () => {
  withHost(FULL_WIRE, () => {
    const counters = GAME_TELEMETRY.readCounters();
    assertEqual(counters.frame_hash, 7, 'gpu spec keys must land');
    assertEqual(counters.text_hash, 13, 'per-pipeline hashes must land for no-React repaint attribution');
    assertEqual(counters.atlas_miss_count, 7, 'per-frame atlas misses must land for exact glyph-raster attribution');
    assertEqual(counters.total, 41, 'nodes spec keys must land');
    assertEqual(counters.active_count, 2, 'input spec keys must land');
    assert(!('zero_size' in counters), 'zero_size is excluded on purpose — its delta is pure noise');
    assert(!('junk' in counters), 'non-spec keys must not leak into the diff set');
  });
});

// ── panel measurement helpers ────────────────────────────────────────────────

test('fpsTone carries the panel idiom thresholds: good >= 55, warn >= 30, bad below', () => {
  assertEqual(GAME_TELEMETRY.fpsTone(240), 'good', '240fps is good');
  assertEqual(GAME_TELEMETRY.fpsTone(55), 'good', 'the 55 boundary is good');
  assertEqual(GAME_TELEMETRY.fpsTone(54), 'warn', 'just under 55 warns');
  assertEqual(GAME_TELEMETRY.fpsTone(30), 'warn', 'the 30 boundary warns');
  assertEqual(GAME_TELEMETRY.fpsTone(29), 'bad', 'under 30 is bad');
});

test('a SampleRing evicts oldest-first and reports stats over the window', () => {
  const ring = GAME_TELEMETRY.createSampleRing(3);
  ring.push(10);
  ring.push(20);
  ring.push(30);
  ring.push(40); // evicts 10
  ring.push(NaN); // ignored, not a sample
  assertEqual(ring.count(), 3, 'capacity must hold');
  assertEqual(ring.values().join(','), '20,30,40', 'values are chronological, oldest evicted');
  assertEqual(ring.last(), 40, 'last sample');
  assertEqual(ring.min(), 20, 'min over the window');
  assertEqual(ring.max(), 40, 'max over the window');
  assertClose(ring.average(), 30, 1e-9, 'average over the window');
});

test('formatUs speaks ms above 1000us', () => {
  assertEqual(GAME_TELEMETRY.formatUs(500), '500us', 'sub-millisecond stays in us');
  assertEqual(GAME_TELEMETRY.formatUs(4200), '4.20ms', 'above 1000us reads as ms');
});

// ── the spike detector ───────────────────────────────────────────────────────

test('median: odd and even windows', () => {
  assertEqual(GAME_TELEMETRY.median([5, 1, 9]), 5, 'odd window takes the middle');
  assertEqual(GAME_TELEMETRY.median([4, 2, 8, 6]), 5, 'even window averages the middle pair');
  assertEqual(GAME_TELEMETRY.median([]), 0, 'empty window is 0');
});

test('the detector needs BOTH gates: ratio AND absolute jump', () => {
  // The canonical dip: calm 4167us (240fps), spike 5263us (190fps) — ratio
  // 1.26 > 1.15 and jump 1096us > 500us. Must fire.
  const dip = [5263, 4167, 4167, 4167, 4167, 4167, 4167];
  const hit = GAME_TELEMETRY.detectSpike(dip);
  assertEqual(hit.isSpike, true, 'the canonical 240→190 dip must detect');
  assertEqual(hit.baselineUs, 4167, 'baseline is the ring median');
  assertEqual(hit.worstUs, 5263, 'worst is the ring max');

  // Fast frames: ratio passes (2x) but the absolute jump (200us) is under the
  // 500us gate — proportional jitter on fast frames must NOT fire.
  const jitter = [400, 200, 200, 200, 200];
  assertEqual(GAME_TELEMETRY.detectSpike(jitter).isSpike, false, 'ratio without the jump gate must not fire');

  // Slow frames: jump passes (600us) but ratio (1.06x) is under 1.15 —
  // absolute wobble on slow frames must NOT fire.
  const wobble = [10600, 10000, 10000, 10000, 10000];
  assertEqual(GAME_TELEMETRY.detectSpike(wobble).isSpike, false, 'jump without the ratio gate must not fire');
});

test('under minHistorySamples the baseline is meaningless — never a spike', () => {
  const result = GAME_TELEMETRY.detectSpike([90000, 1000, 1000]);
  assertEqual(result.isSpike, false, 'a 3-sample ring must not detect');
  assertEqual(TELEMETRY_TUNING.spike.minHistorySamples, 4, 'the gate is the tuned 4');
});

// ── the WHAT-FIRED verdict tree ──────────────────────────────────────────────
// A "caught" record: fps 240 implies 4167us; caught needs total > 4167×1.5 =
// 6250us. These records sit well above that with one dominant phase.

function caughtRecord(patch: Partial<FrameRecord>): FrameRecord {
  return {
    fps: 240, tickUs: 100, layoutUs: 100, paintUs: 100, gpuUs: 100, totalUs: 20000, frameNumber: 1,
    eventUs: 0, appTickUs: 0, prePaintUs: 0, postFrameUs: 0,
    gcNs: 0, gcCount: 0, gcType: 0, presentUs: 0, bridgeUs: 0,
    ...patch,
  };
}

test('a node/glyph/mesh swing names CONTENT SWAP above everything else', () => {
  const calm: Counters = { total: 100, atlas_glyph_count: 10 };
  const spike: Counters = { total: 130, atlas_glyph_count: 20 }; // atlas also grew — swap still wins
  const verdict = GAME_TELEMETRY.classifySpike(null, calm, spike);
  assert(verdict.includes('CONTENT SWAP'), `a 30-node swing must read CONTENT SWAP (got: ${verdict})`);
});

test('atlas growth without a tree swing names GLYPH RASTERIZE', () => {
  const verdict = GAME_TELEMETRY.classifySpike(null, { atlas_glyph_count: 10 }, { atlas_glyph_count: 17 });
  assert(verdict.includes('GLYPH RASTERIZE'), `7 new atlas glyphs must read GLYPH RASTERIZE (got: ${verdict})`);
});

test('paint-dominant caught frame: hash flip → REPAINT / CAPTURE RE-BAKE, still hash → CAPTURE RE-BAKE', () => {
  const record = caughtRecord({ paintUs: 18000 });
  const flipped = GAME_TELEMETRY.classifySpike(record, { frame_hash: 1 }, { frame_hash: 2 });
  assert(flipped.includes('REPAINT / CAPTURE RE-BAKE'), `paint + hash flip (got: ${flipped})`);
  const still = GAME_TELEMETRY.classifySpike(record, { frame_hash: 1 }, { frame_hash: 1 });
  assert(still.includes('CAPTURE RE-BAKE') && !still.includes('REPAINT /'), `paint + same hash (got: ${still})`);
});

test('gpu-dominant: a MEASURED present wait is the vsync cap; little present wait is real GPU work', () => {
  // present_us dominates the gpu phase → vblank-capped idle, not a stall.
  const idleRec = caughtRecord({ gpuUs: 18000, presentUs: 17000 });
  const idle = GAME_TELEMETRY.classifySpike(idleRec, { scene3d_draw_calls: 10 }, { scene3d_draw_calls: 10 });
  assert(idle.includes('VSYNC / PRESENT WAIT'), `measured present wait is the refresh cap (got: ${idle})`);
  // present_us tiny → the gpu time was real encode/upload/draw work.
  const realRec = caughtRecord({ gpuUs: 18000, presentUs: 800 });
  const real = GAME_TELEMETRY.classifySpike(realRec, { scene3d_draw_calls: 10 }, { scene3d_draw_calls: 18 });
  assert(real.includes('GPU DRAW/UPLOAD'), `low present wait makes it real GPU work (got: ${real})`);
  assert(real.includes('+8'), `the verdict carries the signed draw-call delta (got: ${real})`);
});

test('V8 GC is named definitively, with type AND fire-count, whenever its measured pause dominates', () => {
  // GC measured frame-wide can dominate even a tick-attributed frame. 11.3ms = 11_300_000ns.
  const gc = GAME_TELEMETRY.classifySpike(
    caughtRecord({ tickUs: 18000, totalUs: 20000, gcNs: 11_300_000, gcCount: 1, gcType: 4 }),
    { total: 5 }, { total: 5 },
  );
  assert(gc.includes('V8 GC'), `a big measured GC pause is named (got: ${gc})`);
  assert(gc.includes('mark-sweep'), `the GC type is decoded from the bitmask (got: ${gc})`);
  assert(gc.includes('11.30ms'), `the measured GC ms is in the verdict (got: ${gc})`);
  assert(gc.includes('×1'), `the fire-count is in the verdict (got: ${gc})`);
});

test('GC is sub-µs honest and never value-ambiguous: tiny fired vs never fired are distinct', () => {
  // 700ns total across 3 scavenges must NOT floor to "0us" — it reads "700ns ×3"
  // (ns precision below 1µs; even more honest than the illustrative "0.7µs").
  const tiny = GAME_TELEMETRY.gcLabel(700, 3, 1);
  assert(tiny.includes('700ns') && tiny.includes('×3') && tiny.includes('scavenge'),
    `a sub-µs GC shows ns with its count, not "0us" (got: ${tiny})`);
  // And just above 1µs it crosses to µs-with-decimal, e.g. "0.7µs"-style.
  assert(GAME_TELEMETRY.gcLabel(1_700, 2, 1).includes('1.7µs'),
    'just over 1µs reads in µs with a decimal');
  // Zero invocations is a SEPARATE, explicit state — the binding produced nothing.
  const dead = GAME_TELEMETRY.gcLabel(0, 0, 0);
  assert(dead.includes('×0') && dead.includes('never fired'),
    `a 0-count GC says "never fired", not a misleading 0-time (got: ${dead})`);
  // formatGcTime crosses the units honestly.
  assertEqual(GAME_TELEMETRY.formatGcTime(420), '420ns', 'ns below 1µs');
  assertEqual(GAME_TELEMETRY.formatGcTime(1_500), '1.5µs', 'µs with a decimal');
  assertEqual(GAME_TELEMETRY.formatGcTime(2_000_000), '2.00ms', 'ms above 1ms');
});

test('outside-render time is attributed to its MEASURED cause, never "GC / native, one of three"', () => {
  // bridge dominates the outside-render bucket → NATIVE BRIDGE, definitively.
  const bridge = GAME_TELEMETRY.classifySpike(
    caughtRecord({ totalUs: 20000, tickUs: 100, layoutUs: 100, paintUs: 100, gpuUs: 100, bridgeUs: 15000 }),
    { total: 5 }, { total: 5 },
  );
  assert(bridge.includes('NATIVE BRIDGE'), `bridge-dominated other is named bridge (got: ${bridge})`);
  assert(!bridge.includes('GC / NATIVE'), `the old multiple-choice guess is gone (got: ${bridge})`);
  // No measured contributor → its own explicit UNATTRIBUTED bucket (native).
  const native = GAME_TELEMETRY.classifySpike(
    caughtRecord({ totalUs: 20000, tickUs: 100, layoutUs: 100, paintUs: 100, gpuUs: 100, bridgeUs: 0 }),
    { total: 5 }, { total: 5 },
  );
  assert(native.includes('UNATTRIBUTED'), `unbridged native other is explicit, not folded into a cause (got: ${native})`);
});

test('tick-dominant caught frame still names TICK; a dead-still null-record set reports ~0 timers', () => {
  const tick = GAME_TELEMETRY.classifySpike(caughtRecord({ tickUs: 18000 }), { total: 5 }, { total: 5 });
  assert(tick.includes('TICK'), `tick-dominant (got: ${tick})`);
  const ghost = GAME_TELEMETRY.classifySpike(null, { total: 5, glyph_count: 9, frame_hash: 1 }, { total: 5, glyph_count: 9, frame_hash: 1 });
  assert(ghost.includes('boundary timer read'), `nothing moved + no record → measured-but-zero, not a guess (got: ${ghost})`);
});

test('an uncaught hash flip alone names REPAINT (buffer re-upload)', () => {
  const verdict = GAME_TELEMETRY.classifySpike(null, { frame_hash: 1, total: 5 }, { frame_hash: 2, total: 5 });
  assert(verdict.includes('REPAINT') && !verdict.includes('CAPTURE'), `hash flip, no record (got: ${verdict})`);
});

// ── the report shape ─────────────────────────────────────────────────────────

test('a spike report carries verdict, magnitude, deltas, the hash callout, and the tape', () => {
  const lines = GAME_TELEMETRY.buildSpikeReport({
    historyNewestFirstUs: [5263, 4167, 4167, 4167],
    baselineUs: 4167,
    worstUs: 5263,
    calmCounters: { frame_hash: 1, rect_count: 50 },
    spikeCounters: { frame_hash: 2, rect_count: 64 },
    record: caughtRecord({ paintUs: 18000 }),
  });
  const text = lines.join('\n');
  assert(text.includes('GAME PERF SPIKE'), 'report header');
  assert(text.includes('WHAT FIRED:'), 'the verdict line leads');
  assert(text.includes('worst 5.26ms  baseline 4.17ms'), 'magnitude line in human units');
  assert(text.includes('~240fps → ~190fps'), 'the fps translation of the dip');
  assert(text.includes('SPIKE FRAME CAUGHT'), '20000us > 4167×1.5 — the frame was caught');
  assert(text.includes('rect_count 50→64 (+14)'), 'moved counters print as signed before→after deltas');
  assert(text.includes('frame_hash flipped'), 'the hash-flip re-upload callout');
  assert(text.includes('tape (ms, newest first): 5.3 4.2 4.2 4.2'), 'the flight-recorder tape in ms');
});

test('GAP-2: a latched report shows the SPIKE frame buckets and labels them latched', () => {
  const lines = GAME_TELEMETRY.buildSpikeReport({
    historyNewestFirstUs: [8000, 4167, 4167, 4167],
    baselineUs: 4167,
    worstUs: 8000,
    calmCounters: { total: 5 },
    spikeCounters: { total: 5 },
    counterFrameCaught: false, // current-frame owner counters are stale...
    latched: true, // ...but we latched the actual worst frame from the ring
    record: caughtRecord({ totalUs: 8000, tickUs: 100, gpuUs: 100, gcNs: 6_500_000, gcCount: 1, gcType: 4 }),
  });
  const text = lines.join('\n');
  assert(text.includes('SPIKE FRAME CAUGHT (latched from host ring)'), `the report says it latched the spike frame (got: ${text})`);
  assert(text.includes('V8 GC 6.50ms'), `the breakdown shows the SPIKE frame's GC, not a recovered 0 (got: ${text})`);
  assert(!text.includes('SPIKE IN HOST TAPE'), `latched buckets mean we no longer disclaim the whole report (got: ${text})`);
});

test('a report with nothing moved says so instead of printing an empty delta list', () => {
  const lines = GAME_TELEMETRY.buildSpikeReport({
    historyNewestFirstUs: [5263, 4167],
    baselineUs: 4167,
    worstUs: 5263,
    calmCounters: { total: 5 },
    spikeCounters: { total: 5 },
    record: null,
  });
  assert(lines.join('\n').includes('nothing in our draw counters moved'), 'the dead-still case is named');
});

test('a recovered-frame report does not attribute stale counter deltas to the spike', () => {
  const lines = GAME_TELEMETRY.buildSpikeReport({
    historyNewestFirstUs: [4167, 4167, 15000, 4167],
    baselineUs: 4167,
    worstUs: 15000,
    calmCounters: { frame_hash: 1, text_hash: 10, glyph_count: 972, atlas_glyph_count: 363 },
    spikeCounters: { frame_hash: 2, text_hash: 11, glyph_count: 929, atlas_glyph_count: 370 },
    counterFrameCaught: false,
    record: caughtRecord({ totalUs: 4167, paintUs: 200, gpuUs: 3200 }),
    calmTextTrace: 'sz=10 text="stable"',
    spikeTextTrace: 'sz=10 text="stable"',
  });
  const text = lines.join('\n');
  assert(text.includes('SPIKE IN HOST TAPE'), 'the headline must say the owner counters missed the worst frame');
  assert(text.includes('latest recovered-frame diff vs last clean frame'), 'stale deltas may print only as recovered-frame context');
  assert(text.includes('NOT proof'), 'hash-flip callout must be explicit about uncertainty');
  assert(!text.includes('GLYPH RASTERIZE'), 'stale atlas deltas must not drive the verdict');
  assert(!text.includes('text trace unchanged but text_hash flipped'), 'stale text trace must not spam owner-looking evidence');
  assert(!text.includes('recon owner trace'), 'stale deltas must not attach owner trace');
});

test('recon owner trace attaches only fresh churn records, never stale self-noise', () => {
  const report = (at: number) => GAME_TELEMETRY.buildSpikeReport({
    historyNewestFirstUs: [5263, 4167],
    baselineUs: 4167,
    worstUs: 5263,
    calmCounters: { atlas_glyph_count: 10 },
    spikeCounters: { atlas_glyph_count: 17 },
    record: null,
  }).join('\n');
  const g = globalThis as Record<string, unknown>;
  const previous = g.__RECON_CHURN_DUMP;
  try {
    g.__RECON_CHURN_DUMP = () => [{
      commit: 1,
      at: Date.now(),
      events: 1,
      nodes: 7,
      glyphs: 39,
      parts: ['remove PlayRoute@unknown type=View count=1 detail=text="] ▌"|"help · ↑↓ history · PgUp/PgDn sc..."'],
    }];
    assert(report(Date.now()).includes('commit=1'), 'fresh churn can be attached to a matching spike');
    g.__RECON_CHURN_DUMP = () => [{
      commit: 1,
      at: Date.now() - 5000,
      events: 1,
      nodes: 7,
      glyphs: 39,
      parts: ['remove PlayRoute@unknown type=View count=1 detail=text="] ▌"|"help · ↑↓ history · PgUp/PgDn sc..."'],
    }];
    assert(!report(Date.now()).includes('commit=1'), 'stale churn must not be reused for later spikes');
  } finally {
    if (previous === undefined) delete g.__RECON_CHURN_DUMP;
    else g.__RECON_CHURN_DUMP = previous;
  }
});

// ── copy-diagnostics ─────────────────────────────────────────────────────────

test('buildDiagnostics snapshots label, timestamp, availability, every blob, and the lab extras', () => {
  withHost(FULL_WIRE, () => {
    const snapshot = GAME_TELEMETRY.buildDiagnostics('telemetry-test-lab', {
      physics: { hostMicroseconds: 42 },
    });
    assertEqual(snapshot.label, 'telemetry-test-lab', 'the lab names its snapshot');
    assert(/^\d{4}-\d{2}-\d{2}T/.test(snapshot.capturedAt), 'capturedAt is ISO');
    assertEqual(snapshot.availability.complete, true, 'availability rides along');
    assertEqual(snapshot.scalars.fps, 240, 'scalars block');
    assertEqual((snapshot.telemetry.frame as any).frame_total_us, 4200, 'raw frame blob rides untouched');
    assertEqual(snapshot.tapeUs.length, 8, 'the frame tape rides along');
    assertEqual((snapshot.physics as any).hostMicroseconds, 42, 'lab extras (the GAME_PHYSICS feed) land top-level');
  });
});

test('copyDiagnostics puts pretty JSON on the clipboard wire and reports transport honestly', () => {
  assertEqual(GAME_TELEMETRY.copyDiagnostics('nowhere'), false, 'no clipboard wire → false, never a silent no-op');
  let copied = '';
  withHost({ ...FULL_WIRE, __clipboard_set: (text: string) => { copied = text; } }, () => {
    assertEqual(GAME_TELEMETRY.copyDiagnostics('telemetry-test-lab', { note: 'hi' }), true, 'wired → true');
  });
  const parsed = JSON.parse(copied);
  assertEqual(parsed.label, 'telemetry-test-lab', 'the clipboard payload is the snapshot');
  assertEqual(parsed.note, 'hi', 'extras serialize');
  assert(copied.includes('\n  '), 'pretty-printed (2-space) — a bug report a human can read');
});

// ── runtime diagnostics channels ────────────────────────────────────────────

test('diagnostics channels are registered, off by default, and expose settings-ready toggles', () => {
  const names = GAME_TELEMETRY.channels.map((c) => c.name);
  for (const required of ['frame', 'tick', 'physics', 'camera', 'figure', 'worldStream', 'bridge', 'hostFlush', 'draw', 'capture', 'hmr', 'pools', 'churn', 'spikes']) {
    assert(names.includes(required), `${required} channel must be registered`);
  }
  for (const toggle of GAME_TELEMETRY.diagnosticToggles()) {
    GAME_TELEMETRY.setDiagnosticChannel(toggle.channel, false);
    assertEqual(GAME_TELEMETRY.diagnosticChannelEnabled(toggle.channel), false, `${toggle.channel} must be off`);
    assert(toggle.key.startsWith('diagnostics.'), 'toggle keys must match the settings registry hand-off shape');
  }
});

test('camera diagnostics are sampled data; native camera hot paths do not print terminal probes', () => {
  const read = (globalThis as any).__fs_read as ((path: string) => string) | undefined;
  assertEqual(typeof read, 'function', 'v8cli fs read must be available for the source guard');
  const cameraSource = read!('framework/game/camera.zig');
  const bindingSource = read!('framework/v8_bindings_game_camera.zig');
  const v8AppSource = read!('v8_app.zig');
  assert(!cameraSource.includes('std.debug.print'), 'framework/game/camera.zig must not print from the camera step path');
  assert(!bindingSource.includes('std.debug.print'), 'game-camera bindings must not print probe lines from host calls');
  assert(!v8AppSource.includes('[probe-tick]'), 'v8_app ticks must not write unswitchable startup probe lines');
  assert(cameraSource.includes('pub fn probeSnapshot'), 'camera probe data must remain available as a sampled snapshot');
  assert(bindingSource.includes('__game_camera_probe'), 'the diagnostics channel must have a host-readable camera probe');
});

test('diagnostics aggregate only when enabled and flush structured JSONL to the predictable path', () => {
  let wrotePath = '';
  let wroteText = '';
  withHost({ __fs_write: (path: string, text: string) => { wrotePath = path; wroteText = text; return true; } }, () => {
    GAME_TELEMETRY.setDiagnosticChannel('bridge', false);
    GAME_TELEMETRY.recordDiagnostic('bridge', 'off-sample', { payloadBytes: 99 });
    GAME_TELEMETRY.flushDiagnostics();
    assert(!wroteText.includes('off-sample'), 'off channel samples must disappear after the branch');

    GAME_TELEMETRY.setDiagnosticChannel('bridge', true);
    GAME_TELEMETRY.recordDiagnostic('bridge', '__test_host', { payloadBytes: 16, args: 2 });
    GAME_TELEMETRY.flushDiagnosticChannel('bridge');
    GAME_TELEMETRY.flushDiagnostics();
    GAME_TELEMETRY.setDiagnosticChannel('bridge', false);
  });
  assertEqual(wrotePath, TELEMETRY_TUNING.diagnostics.logPath, 'diagnostics write to the one predictable JSONL path');
  const lines = wroteText.trim().split('\n').map((line) => JSON.parse(line));
  const aggregate = lines.find((line) => line.channel === 'bridge' && line.type === 'aggregate');
  assert(!!aggregate, 'enabled channel must flush an aggregate record');
  assertEqual(aggregate.data.labels.__test_host, 1, 'aggregate counts labels by host fn');
  assertEqual(aggregate.data.numeric.payloadBytes.last, 16, 'numeric payload stats ride the aggregate');
});

test('all-off overhead probe reports measured branch cost numbers', () => {
  const result = GAME_TELEMETRY.estimateDiagnosticOffOverhead(1000);
  assertEqual(result.iterations, 1000, 'iteration count is caller-controlled');
  assert(Number.isFinite(result.baselineMs), 'baselineMs is numeric');
  assert(Number.isFinite(result.offMs), 'offMs is numeric');
  assert(Number.isFinite(result.perCallNs), 'perCallNs is numeric');
});

// ── the door itself ──────────────────────────────────────────────────────────

test('the door is sealed and carries the knob surface', () => {
  assert(Object.isFrozen(GAME_TELEMETRY), 'GAME_TELEMETRY must be frozen');
  assertEqual(GAME_TELEMETRY.tuning, TELEMETRY_TUNING, 'tuning rides the door');
  assertEqual(TELEMETRY_TUNING.panel.scalarPollMs, 250, 'the panel idiom cadence: scalars @250ms');
  assertEqual(TELEMETRY_TUNING.panel.snapshotPollMs, 500, 'the panel idiom cadence: JSON @500ms');
  assertEqual(TELEMETRY_TUNING.diagnostics.logPath, '/tmp/hmsc-int-diagnostics.jsonl', 'one predictable diagnostics path');
});

finish('game/telemetry');
