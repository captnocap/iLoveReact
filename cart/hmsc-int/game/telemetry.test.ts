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
  __tel_frame: () => ({ fps: 240, tick_us: 300, layout_us: 120, paint_us: 800, gpu_us: 2900, frame_total_us: 4200, frame_number: 9001 }),
  __tel_gpu: () => ({ frame_hash: 7, rect_count: 64, glyph_count: 210, zero_size: 999999, junk: 'no' }),
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
    assertEqual(frame!.frameNumber, 9001, 'frame_number → frameNumber');
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
  return { fps: 240, tickUs: 100, layoutUs: 100, paintUs: 100, gpuUs: 100, totalUs: 20000, frameNumber: 1, ...patch };
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

test('gpu-dominant with idle CPU and still draw calls is the vsync wait, not a stall', () => {
  const record = caughtRecord({ gpuUs: 18000 });
  const idle = GAME_TELEMETRY.classifySpike(record, { scene3d_draw_calls: 10 }, { scene3d_draw_calls: 10 });
  assert(idle.includes('VSYNC / PRESENT WAIT'), `idle gpu phase is the refresh cap (got: ${idle})`);
  const real = GAME_TELEMETRY.classifySpike(record, { scene3d_draw_calls: 10 }, { scene3d_draw_calls: 18 });
  assert(real.includes('GPU DRAW/UPLOAD'), `a draw-call swing makes it real GPU work (got: ${real})`);
  assert(real.includes('+8'), `the verdict carries the signed draw-call delta (got: ${real})`);
});

test('tick-dominant caught frame names TICK; a dead-still counter set names GC / NATIVE', () => {
  const tick = GAME_TELEMETRY.classifySpike(caughtRecord({ tickUs: 18000 }), { total: 5 }, { total: 5 });
  assert(tick.includes('TICK'), `tick-dominant (got: ${tick})`);
  const ghost = GAME_TELEMETRY.classifySpike(null, { total: 5, glyph_count: 9, frame_hash: 1 }, { total: 5, glyph_count: 9, frame_hash: 1 });
  assert(ghost.includes('GC / NATIVE'), `nothing moved (got: ${ghost})`);
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

test('a report with nothing moved says so instead of printing an empty delta list', () => {
  const lines = GAME_TELEMETRY.buildSpikeReport({
    historyNewestFirstUs: [5263, 4167],
    baselineUs: 4167,
    worstUs: 5263,
    calmCounters: { total: 5 },
    spikeCounters: { total: 5 },
    record: null,
  });
  assert(lines.join('\n').includes('nothing in our counters moved'), 'the dead-still case is named');
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
  for (const required of ['frame', 'tick', 'physics', 'camera', 'figure', 'worldStream', 'bridge', 'draw', 'capture', 'hmr', 'pools', 'churn', 'spikes']) {
    assert(names.includes(required), `${required} channel must be registered`);
  }
  for (const toggle of GAME_TELEMETRY.diagnosticToggles()) {
    GAME_TELEMETRY.setDiagnosticChannel(toggle.channel, false);
    assertEqual(GAME_TELEMETRY.diagnosticChannelEnabled(toggle.channel), false, `${toggle.channel} must be off`);
    assert(toggle.key.startsWith('diagnostics.'), 'toggle keys must match the settings registry hand-off shape');
  }
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
