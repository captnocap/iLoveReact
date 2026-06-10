// game/telemetry.ts — GAME_TELEMETRY: the measurement + copy-diagnostics
// surface every lab gets for free (V14: "Telemetry panel + copy-diagnostics
// button: in").
//
// THE FENCE: this module MEASURES — it reads the host's `__tel_*` counters,
// names what a perf spike was, and serializes the full diagnostic snapshot to
// the clipboard. It renders NOTHING. The panel that displays these numbers is
// chrome's (game/chrome Panel/Meter + the labs route); chrome polls THIS
// surface at the cadences in TELEMETRY_TUNING.panel and maps tones to colors.
//
// Fresh capture (V17-TRIAGE) of three behavior references, untouched:
// • cart/hmsc/state/perfWatch.ts — the gv_perflog spike flight recorder:
//   baseline = median of the host frame ring, two-gate spike detection
//   (ratio AND absolute jump), calm-vs-spike counter diffing, the
//   plain-English WHAT FIRED classifier, the cooldown, the tape.
// • cart/hmsc_massive_map_lab.tsx — the copy-diagnostics button: one JSON
//   snapshot (label, capturedAt, every telemetry blob, domain extras) to the
//   system clipboard via __clipboard_set.
// • the telemetry panel idiom (render_perf_lab / hmsc_massive_map_lab):
//   scalars @250ms + JSON @500ms + fps thresholds (good ≥55, warn ≥30).
//
// The host fn vocabulary is runtime/hooks/useTelemetry.ts's catalog; this door
// carries the GAME subset (frame/gpu/nodes/input + the scalars + the history
// ring) as table data. The wider platform catalog (net/system/processes/…)
// stays in useTelemetry — a lab that wants OS process listings is doing
// platform work, not game work.
//
// HONESTY RULE (the ruled-in fix for the "diagnostics silently degrade"
// hazard): every read tolerates a missing host fn, and availability() names
// exactly which fns are absent so the panel can SAY "telemetry not wired"
// instead of rendering zeros as truth.
//
// First feeds beyond the host counters: GAME_PHYSICS's step result already
// returns hostMicroseconds — labs hand numbers like that to a SampleRing and
// to buildDiagnostics' extra block; this door does not reach into physics.

import { callHost, hasHost } from '@reactjit/ffi';
import { writeFile } from '@reactjit/hooks/fs';

declare const globalThis: { console?: { warn?: (text: string) => void } } & Record<string, unknown>;

// ── THE TUNING TABLE (P2 — every behavior-affecting number lives here) ──────

export const TELEMETRY_TUNING = {
  panel: {
    // The panel idiom's cadences: scalars fast, JSON snapshots slower.
    scalarPollMs: 250,
    snapshotPollMs: 500,
    // fps tone thresholds: good ≥55, warn ≥30, bad below. Tones, not colors —
    // chrome owns the palette.
    fpsGoodAt: 55,
    fpsWarnAt: 30,
  },
  sampler: {
    // Default SampleRing capacity — half a second of 240fps frames, the same
    // cushion the host ring carries.
    capacity: 120,
  },
  spike: {
    // A host frame counts as a spike when it is BOTH this many times the calm
    // baseline AND at least this many microseconds slower — two gates so
    // proportional jitter on fast frames and tiny absolute wobble on slow
    // ones are both ignored. 1.15 catches the canonical 240→190fps dip
    // (4.17ms→5.26ms ≈ 1.26×) with margin.
    spikeRatio: 1.15,
    minJumpUs: 500,
    // One report per window — a spike lasting several frames is one event.
    cooldownMs: 400,
    // The flight-recorder tape length printed in a report.
    recorderFrames: 48,
    // How much of the host frame ring a detection pass reads (the host keeps
    // up to 120 — at 240fps that is half a second of cushion, why single-
    // frame spikes can't slip between ~60Hz JS ticks).
    historyFrames: 120,
    // Below this many ring samples the baseline is meaningless — never spike.
    minHistorySamples: 4,
    // "Did __tel_frame actually carry the spike frame?" gate: totalUs must
    // exceed baseline × this. (The reference used this ratio against BOTH the
    // measured baseline in its report and the fps-implied baseline in its
    // classifier — carried faithfully, see classifySpike.)
    caughtRatio: 1.5,
  },
  classify: {
    // Counter-swing thresholds that name the spike (perfWatch's verdict tree).
    nodeSwingAt: 20,
    glyphSwingAt: 50,
    meshSwingAt: 12,
    atlasGrowthAt: 5,
    // gpu-phase = present/vsync wait unless real CPU work or draw-call swing.
    vsyncCpuUsBelow: 1500,
    vsyncDrawSwingBelow: 3,
    // V8 GC is measured frame-wide; name it as the headline cause when its
    // pause both clears this floor AND is at least this fraction of the frame.
    gcDominantUsFloor: 1500,
    gcDominantFrameFraction: 0.4,
    // present_us (measured vsync wait) is "the frame was idle-capped" rather
    // than "real GPU work" when it is at least this fraction of the gpu phase.
    presentDominantGpuFraction: 0.6,
  },
  diagnostics: {
    // Frame-time tape carried in a copy-diagnostics snapshot.
    tapeFrames: 48,
    logPath: '/tmp/hmsc-int-diagnostics.jsonl',
    flushMs: 250,
    maxTextBytes: 1_200_000,
    aggregateWindowMs: 1000,
  },
} as const;

// ── Runtime diagnostics channels (PERFLOG-0605) ────────────────────────────

export type DiagnosticChannel =
  | 'frame'
  | 'tick'
  | 'physics'
  | 'camera'
  | 'figure'
  | 'worldStream'
  | 'bridge'
  | 'hostFlush'
  | 'draw'
  | 'capture'
  | 'hmr'
  | 'pools'
  | 'churn'
  | 'spikes';

export type DiagnosticChannelSpec = {
  name: DiagnosticChannel;
  label: string;
  purpose: string;
  source: string;
  defaultEnabled: boolean;
};

export const DIAGNOSTIC_CHANNELS: readonly DiagnosticChannelSpec[] = Object.freeze([
  { name: 'frame', label: 'Frame timing', purpose: 'dt distribution, frame tape, spikes', source: 'GAME_TELEMETRY host frame reads', defaultEnabled: false },
  { name: 'tick', label: 'Game tick', purpose: 'state tick and reconciliation timing', source: 'GAME_LOOP/game routes', defaultEnabled: false },
  { name: 'physics', label: 'Physics step', purpose: 'host step us, bodies, rect counts, payload sizes', source: 'GAME_PHYSICS.step/registerHeightfield', defaultEnabled: false },
  { name: 'camera', label: 'Camera solve', purpose: 'native camera modes, params, deltas, solved lag', source: 'framework/game/camera.zig + nativeCamera.ts', defaultEnabled: false },
  { name: 'figure', label: 'Figure rig', purpose: 'rig build/sample counts and part counts', source: 'GAME_FIGURE consumers', defaultEnabled: false },
  { name: 'worldStream', label: 'World stream IO', purpose: 'stream reads/writes/snapshot sizes', source: 'V20 data/store + world streams', defaultEnabled: false },
  { name: 'bridge', label: 'JS-host bridge', purpose: 'calls per host fn and payload byte estimates', source: 'transport wrappers/callHost seams', defaultEnabled: false },
  { name: 'hostFlush', label: 'Host flush', purpose: 'React queue batches, bytes, and drain cost per frame', source: '__hostFlush queue / v8 reconciler drain', defaultEnabled: false },
  { name: 'draw', label: 'Draw/instances', purpose: 'draw calls, instances, mesh/capture counts', source: '__tel_gpu snapshots', defaultEnabled: false },
  { name: 'capture', label: 'Static captures', purpose: 'paint/capture rebuilds, upload churn', source: 'perfLog/useChurn + capture call sites', defaultEnabled: false },
  { name: 'hmr', label: 'HMR/bundle', purpose: 'bundle push/build timing', source: 'dev/HMR hooks hand-off', defaultEnabled: false },
  { name: 'pools', label: 'Pools/slots', purpose: 'node pools, camera slots, physics slots occupancy', source: 'host telemetry + per-node camera controller', defaultEnabled: false },
  { name: 'churn', label: 'React churn', purpose: 'render churn, identity changes, editor paint perf lines', source: 'perfLog.ts folded into diagnostics', defaultEnabled: false },
  { name: 'spikes', label: 'Spike recorder', purpose: 'legacy perfWatch spike flight-recorder reports', source: 'startSpikeWatch', defaultEnabled: false },
] as const);

const CHANNEL_SET = new Set<DiagnosticChannel>(DIAGNOSTIC_CHANNELS.map((c) => c.name));

export type DiagnosticToggle = {
  key: string;
  channel: DiagnosticChannel;
  label: string;
  value: boolean;
  defaultValue: boolean;
};

type DiagnosticAggregate = {
  channel: DiagnosticChannel;
  count: number;
  firstMs: number;
  lastMs: number;
  payloadBytes: number;
  labels: Record<string, number>;
  numeric: Record<string, { count: number; sum: number; min: number; max: number; last: number }>;
  last?: Record<string, unknown>;
};

type DiagnosticRecord = {
  ts: string;
  ms: number;
  channel: DiagnosticChannel;
  type: 'aggregate' | 'snapshot' | 'control';
  data: Record<string, unknown>;
};

const gDiag = globalThis as typeof globalThis & {
  __hmsc_diag_enabled?: Record<string, boolean>;
  __hmsc_spike_watch_enabled?: boolean;
  __hmsc_spike_watch_stop?: () => void;
  __hmsc_spike_watch_config?: SpikeWatchConfig;
};

const diagnosticEnabled: Record<string, boolean> = gDiag.__hmsc_diag_enabled ?? {};
gDiag.__hmsc_diag_enabled = diagnosticEnabled;
const previousSpikeWatchStop = gDiag.__hmsc_spike_watch_stop;
if (typeof previousSpikeWatchStop === 'function') {
  try { previousSpikeWatchStop(); } catch {}
  gDiag.__hmsc_spike_watch_stop = undefined;
}
for (const spec of DIAGNOSTIC_CHANNELS) {
  if (diagnosticEnabled[spec.name] == null) diagnosticEnabled[spec.name] = spec.defaultEnabled;
}

let diagnosticFileText = '';
let diagnosticLines: string[] = [];
let diagnosticFlushTimer: unknown = null;
let diagnosticStarted = false;
let diagnosticLastFlushMs = 0;
let diagnosticSamplerTimer: unknown = null;
let diagnosticLastSampleMs = 0;
let diagnosticSampling = false;
const diagnosticAggregates: Partial<Record<DiagnosticChannel, DiagnosticAggregate>> = {};

function perfNow(): number {
  const perf = (globalThis as any).performance;
  return typeof perf?.now === 'function' ? perf.now() : Date.now();
}

function diagnosticPath(): string {
  return TELEMETRY_TUNING.diagnostics.logPath;
}

function scheduleDiagnosticFlush(): void {
  if (diagnosticFlushTimer != null) return;
  const timer = (globalThis as any).setTimeout;
  if (typeof timer !== 'function') return;
  diagnosticFlushTimer = timer(flushDiagnostics, TELEMETRY_TUNING.diagnostics.flushMs);
}

function appendDiagnosticRecord(record: DiagnosticRecord): void {
  diagnosticLines.push(JSON.stringify(record));
  scheduleDiagnosticFlush();
}

function ensureDiagnosticStarted(): void {
  if (diagnosticStarted) return;
  diagnosticStarted = true;
  appendDiagnosticRecord({
    ts: new Date().toISOString(),
    ms: perfNow(),
    channel: 'frame',
    type: 'control',
    data: {
      event: 'session.start',
      path: diagnosticPath(),
      channels: DIAGNOSTIC_CHANNELS.map((c) => c.name),
    },
  });
}

export function flushDiagnostics(): void {
  diagnosticFlushTimer = null;
  if (!diagnosticLines.length) return;
  diagnosticFileText += diagnosticLines.join('\n') + '\n';
  diagnosticLines = [];
  const max = TELEMETRY_TUNING.diagnostics.maxTextBytes;
  if (diagnosticFileText.length > max) diagnosticFileText = diagnosticFileText.slice(diagnosticFileText.length - max);
  try { writeFile(diagnosticPath(), diagnosticFileText); } catch {}
}

export function clearDiagnostics(): void {
  diagnosticLines = [];
  diagnosticFileText = '';
  for (const spec of DIAGNOSTIC_CHANNELS) diagnosticAggregates[spec.name] = undefined;
  try { writeFile(diagnosticPath(), ''); } catch {}
}

export function isDiagnosticChannel(value: string): value is DiagnosticChannel {
  return CHANNEL_SET.has(value as DiagnosticChannel);
}

export function diagnosticChannelEnabled(channel: DiagnosticChannel): boolean {
  return diagnosticEnabled[channel] === true;
}

export function diagnosticToggles(): DiagnosticToggle[] {
  return DIAGNOSTIC_CHANNELS.map((spec) => ({
    key: `diagnostics.${spec.name}`,
    channel: spec.name,
    label: spec.label,
    value: diagnosticChannelEnabled(spec.name),
    defaultValue: spec.defaultEnabled,
  }));
}

export function setDiagnosticChannel(channel: DiagnosticChannel, enabled: boolean): void {
  diagnosticEnabled[channel] = enabled;
  ensureDiagnosticStarted();
  appendDiagnosticRecord({
    ts: new Date().toISOString(),
    ms: perfNow(),
    channel,
    type: 'control',
    data: { event: 'channel.toggle', enabled },
  });
  ensureDiagnosticSampler();
  flushDiagnostics();
}

export function diagnosticStatus(): { path: string; channels: Array<DiagnosticChannelSpec & { enabled: boolean }> } {
  return {
    path: diagnosticPath(),
    channels: DIAGNOSTIC_CHANNELS.map((spec) => ({ ...spec, enabled: diagnosticChannelEnabled(spec.name) })),
  };
}

function aggregateFor(channel: DiagnosticChannel, nowMs: number): DiagnosticAggregate {
  let agg = diagnosticAggregates[channel];
  if (!agg) {
    agg = {
      channel,
      count: 0,
      firstMs: nowMs,
      lastMs: nowMs,
      payloadBytes: 0,
      labels: {},
      numeric: {},
    };
    diagnosticAggregates[channel] = agg;
  }
  return agg;
}

function addNumeric(agg: DiagnosticAggregate, key: string, value: number): void {
  if (!Number.isFinite(value)) return;
  const stat = agg.numeric[key] ?? { count: 0, sum: 0, min: value, max: value, last: value };
  stat.count += 1;
  stat.sum += value;
  stat.min = Math.min(stat.min, value);
  stat.max = Math.max(stat.max, value);
  stat.last = value;
  agg.numeric[key] = stat;
}

function summarizeAggregate(agg: DiagnosticAggregate): Record<string, unknown> {
  const numeric: Record<string, unknown> = {};
  for (const [key, stat] of Object.entries(agg.numeric)) {
    numeric[key] = {
      count: stat.count,
      avg: stat.count ? stat.sum / stat.count : 0,
      min: stat.min,
      max: stat.max,
      last: stat.last,
    };
  }
  return {
    count: agg.count,
    windowMs: Math.max(0, agg.lastMs - agg.firstMs),
    payloadBytes: agg.payloadBytes,
    labels: agg.labels,
    numeric,
    last: agg.last ?? null,
  };
}

export function flushDiagnosticChannel(channel: DiagnosticChannel): void {
  const agg = diagnosticAggregates[channel];
  if (!agg || agg.count === 0) return;
  appendDiagnosticRecord({
    ts: new Date().toISOString(),
    ms: perfNow(),
    channel,
    type: 'aggregate',
    data: summarizeAggregate(agg),
  });
  diagnosticAggregates[channel] = undefined;
  diagnosticLastFlushMs = perfNow();
}

export function recordDiagnostic(channel: DiagnosticChannel, label: string, fields: Record<string, unknown> = {}): void {
  if (diagnosticEnabled[channel] !== true) return;
  if (!diagnosticSampling && diagnosticSamplerTimer == null && samplerNeeded()) ensureDiagnosticSampler();
  ensureDiagnosticStarted();
  const nowMs = perfNow();
  const agg = aggregateFor(channel, nowMs);
  agg.count += 1;
  agg.lastMs = nowMs;
  agg.labels[label] = (agg.labels[label] ?? 0) + 1;
  let payloadBytes = 0;
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === 'number') addNumeric(agg, key, value);
    else if (typeof value === 'string') payloadBytes += value.length;
  }
  payloadBytes += label.length;
  agg.payloadBytes += payloadBytes;
  agg.last = { label, ...fields };
  const due =
    diagnosticLastFlushMs === 0 ||
    nowMs - Math.max(diagnosticLastFlushMs, agg.firstMs) >= TELEMETRY_TUNING.diagnostics.aggregateWindowMs;
  if (due) flushDiagnosticChannel(channel);
}

function samplerNeeded(): boolean {
  return diagnosticChannelEnabled('frame') ||
    diagnosticChannelEnabled('hostFlush') ||
    diagnosticChannelEnabled('camera') ||
    diagnosticChannelEnabled('draw') ||
    diagnosticChannelEnabled('pools') ||
    diagnosticChannelEnabled('tick');
}

function ensureDiagnosticSampler(): void {
  if (diagnosticSamplerTimer != null || !samplerNeeded()) return;
  const timer = (globalThis as any).setTimeout;
  if (typeof timer !== 'function') return;
  diagnosticLastSampleMs = perfNow();
  const tick = () => {
    diagnosticSamplerTimer = null;
    if (!samplerNeeded()) return;
    diagnosticSampling = true;
    try {
      sampleHostDiagnostics();
    } finally {
      diagnosticSampling = false;
    }
    diagnosticSamplerTimer = timer(tick, TELEMETRY_TUNING.diagnostics.aggregateWindowMs);
  };
  diagnosticSamplerTimer = timer(tick, TELEMETRY_TUNING.diagnostics.aggregateWindowMs);
}

function sampleHostDiagnostics(): void {
  const nowMs = perfNow();
  const dtMs = diagnosticLastSampleMs ? nowMs - diagnosticLastSampleMs : 0;
  diagnosticLastSampleMs = nowMs;
  if (diagnosticChannelEnabled('frame')) {
    const frame = readFrame();
    if (frame) {
      recordDiagnostic('frame', 'host-frame', {
        dtMs,
        fps: frame.fps,
        tickUs: frame.tickUs,
        layoutUs: frame.layoutUs,
        paintUs: frame.paintUs,
        gpuUs: frame.gpuUs,
        totalUs: frame.totalUs,
        eventUs: frame.eventUs,
        appTickUs: frame.appTickUs,
        prePaintUs: frame.prePaintUs,
        postFrameUs: frame.postFrameUs,
        frameNumber: frame.frameNumber,
      });
    }
    const history = readFrameHistory(TELEMETRY_TUNING.diagnostics.tapeFrames);
    if (history.length) {
      recordDiagnostic('frame', 'history', {
        samples: history.length,
        worstUs: Math.max(...history),
        medianUs: median(history),
      });
    }
  }
  if (diagnosticChannelEnabled('hostFlush')) {
    const hostFlush = readSnapshot('hostFlush');
    if (hostFlush) {
      recordDiagnostic('hostFlush', 'reconciler-drain', {
        queuedBatches: Number(hostFlush.queued_batches) || 0,
        queuedBytes: Number(hostFlush.queued_bytes) || 0,
        lastDrainBatches: Number(hostFlush.last_drain_batches) || 0,
        lastDrainBytes: Number(hostFlush.last_drain_bytes) || 0,
        lastDrainUs: Number(hostFlush.last_drain_us) || 0,
        totalEnqueuedBatches: Number(hostFlush.total_enqueued_batches) || 0,
        totalEnqueuedBytes: Number(hostFlush.total_enqueued_bytes) || 0,
        totalDrainedBatches: Number(hostFlush.total_drained_batches) || 0,
        totalDrainedBytes: Number(hostFlush.total_drained_bytes) || 0,
      });
    }
  }
  if (diagnosticChannelEnabled('camera')) {
    const camera = callHost<Record<string, unknown> | null>(CAMERA_PROBE_HOST_FN, null);
    if (camera) {
      recordDiagnostic('camera', 'native-probe', {
        nodeId: Number(camera.node_id) || 0,
        activeNodeId: Number(camera.active_node_id) || 0,
        frames: Number(camera.frames) || 0,
        avgDtMs: Number(camera.avg_dt_ms) || 0,
        lastDtMs: Number(camera.last_dt_ms) || 0,
        params: Number(camera.params) || 0,
        modes: Number(camera.modes) || 0,
        deltas: Number(camera.deltas) || 0,
        lastParamAgeMs: Number(camera.last_param_age_ms) || 0,
        maxSolvedStep: Number(camera.max_solved_step) || 0,
        maxPosLag: Number(camera.max_pos_lag) || 0,
        maxTargetLag: Number(camera.max_target_lag) || 0,
        mode: String(camera.mode ?? ''),
      });
    }
  }
  if (diagnosticChannelEnabled('draw') || diagnosticChannelEnabled('pools')) {
    const gpu = readSnapshot('gpu');
    if (gpu && diagnosticChannelEnabled('draw')) {
      recordDiagnostic('draw', 'gpu', {
        rects: Number(gpu.rect_count) || 0,
        glyphs: Number(gpu.glyph_count) || 0,
        scene3dInstances: Number(gpu.scene3d_instances) || 0,
        scene3dDrawCalls: Number(gpu.scene3d_draw_calls) || 0,
        scene3dMeshes: Number(gpu.scene3d_meshes_collected) || 0,
        scene3dDropped: Number(gpu.scene3d_meshes_dropped) || 0,
        scene3dChildren: Number(gpu.scene3d_mesh_children) || 0,
      });
    }
    const nodes = readSnapshot('nodes');
    const input = readSnapshot('input');
    if (diagnosticChannelEnabled('pools')) {
      recordDiagnostic('pools', 'host-pools', {
        nodesTotal: Number(nodes?.total) || 0,
        nodesVisible: Number(nodes?.visible) || 0,
        nodesHidden: Number(nodes?.hidden) || 0,
        inputActive: Number(input?.active_count) || 0,
        inputTypes: Number(input?.type_count) || 0,
      });
    }
  }
  if (diagnosticChannelEnabled('tick')) {
    recordDiagnostic('tick', 'sampler', { dtMs });
  }
}

export function diagnosticDump(label: string = 'manual'): { path: string; snapshot: Record<string, unknown> } {
  ensureDiagnosticStarted();
  for (const spec of DIAGNOSTIC_CHANNELS) flushDiagnosticChannel(spec.name);
  const snapshot = {
    label,
    capturedAt: new Date().toISOString(),
    status: diagnosticStatus(),
    telemetry: buildDiagnostics(`diagnostic-dump:${label}`),
  };
  appendDiagnosticRecord({
    ts: new Date().toISOString(),
    ms: perfNow(),
    channel: 'frame',
    type: 'snapshot',
    data: snapshot,
  });
  flushDiagnostics();
  return { path: diagnosticPath(), snapshot };
}

export function estimateDiagnosticOffOverhead(iterations: number = 100_000): { iterations: number; baselineMs: number; offMs: number; perCallNs: number } {
  const n = Math.max(1, Math.floor(iterations));
  const saved = diagnosticEnabled.frame;
  diagnosticEnabled.frame = false;
  let sink = 0;
  const b0 = perfNow();
  for (let i = 0; i < n; i += 1) sink += i & 1;
  const b1 = perfNow();
  for (let i = 0; i < n; i += 1) {
    if (diagnosticEnabled.frame === true) sink += 1;
    sink += i & 1;
  }
  const b2 = perfNow();
  diagnosticEnabled.frame = saved;
  if (sink === -1) recordDiagnostic('frame', 'impossible');
  const baselineMs = b1 - b0;
  const offMs = b2 - b1;
  const deltaMs = Math.max(0, offMs - baselineMs);
  return {
    iterations: n,
    baselineMs,
    offMs,
    perCallNs: (deltaMs * 1_000_000) / n,
  };
}

// ── The wire vocabulary (kind → registered host fn, as table data) ──────────

export type ScalarKind = 'fps' | 'layoutUs' | 'paintUs' | 'tickUs' | 'nodeCount';
export type SnapshotKind = 'frame' | 'gpu' | 'nodes' | 'input' | 'hostFlush';

export const SCALAR_HOST_FN: Record<ScalarKind, string> = {
  fps: 'getFps',
  layoutUs: 'getLayoutUs',
  paintUs: 'getPaintUs',
  tickUs: 'getTickUs',
  nodeCount: '__tel_node_count',
};

export const SNAPSHOT_HOST_FN: Record<SnapshotKind, string> = {
  frame: '__tel_frame',
  gpu: '__tel_gpu',
  nodes: '__tel_nodes',
  input: '__tel_input',
  hostFlush: '__tel_host_flush',
};

const HISTORY_HOST_FN = '__tel_history';
const CLIPBOARD_HOST_FN = '__clipboard_set';
const CAMERA_PROBE_HOST_FN = '__game_camera_probe';

// The flat counter set worth diffing across a spike — everything here should
// be DEAD STILL at idle, so any field that moves on the spike frame is a
// candidate cause. `zero_size` is omitted on purpose: the host counter reads
// cumulative/garbage (oscillates far above `total`), its delta is pure noise.
export const COUNTER_SPEC: Partial<Record<SnapshotKind, readonly string[]>> = {
  gpu: [
    'frame_hash',
    'rect_hash',
    'text_hash',
    'curves_hash',
    'capsules_hash',
    'polys_hash',
    'rect_count',
    'glyph_count',
    'glyph_capacity',
    // Atlas counters: a paint-dominated spike that re-rasterizes the font
    // atlas shows as atlas_glyph_count jumping — the tell for "37ms paint =
    // atlas rebuild" vs "draw data just re-uploaded".
    'atlas_glyph_count',
    'atlas_miss_count',
    'atlas_capacity',
    'frames_since_drain',
    'scene3d_instances',
    'scene3d_draw_calls',
    'scene3d_meshes_collected',
    'scene3d_meshes_dropped',
    'scene3d_mesh_children',
    'static_capture_count',
  ],
  nodes: ['total', 'visible', 'hidden'],
  input: ['active_count', 'type_count', 'focused_id'],
};

// ── Reads (every one tolerates a missing host fn) ───────────────────────────

export type FrameRecord = {
  fps: number;
  tickUs: number;
  layoutUs: number;
  paintUs: number;
  gpuUs: number;
  totalUs: number;
  eventUs: number;
  appTickUs: number;
  prePaintUs: number;
  postFrameUs: number;
  frameNumber: number;
  // Outside-render attribution, measured host-side at real boundaries (V8 GC
  // callbacks, gpu present timing, Zig→JS bridge timing). Lets the classifier
  // name the ONE cause instead of guessing "GC / native / vsync".
  gcNs: number; // V8 GC wall-time this frame in NANOSECONDS (sub-µs honest)
  gcCount: number; // GC invocations this frame — 0 means the GC never fired (vs tiny)
  gcType: number; // GCType bitmask: 1 scavenge, 2 minor-ms, 4 mark-sweep, 8 incremental, 16 weak
  presentUs: number; // vsync/present wait — a subset of gpuUs
  bridgeUs: number; // Zig→JS crossings (app tick + events) — lives in `other`
};

export type Counters = Record<string, number>;

export type TelemetryAvailability = {
  /** every wire fn this door wants that the host did NOT register */
  missing: string[];
  /** true when the full measurement + clipboard surface is wired */
  complete: boolean;
};

/** Which of this door's host fns are actually registered — the panel renders
 *  "telemetry not wired" off this instead of presenting zeros as truth. */
export function availability(): TelemetryAvailability {
  const wanted = [
    ...Object.values(SCALAR_HOST_FN),
    ...Object.values(SNAPSHOT_HOST_FN),
    HISTORY_HOST_FN,
    CLIPBOARD_HOST_FN,
  ];
  const missing = wanted.filter((name) => !hasHost(name));
  return { missing, complete: missing.length === 0 };
}

/** One scalar read (fps / layoutUs / paintUs / tickUs / nodeCount). 0 when unwired. */
export function readScalar(kind: ScalarKind): number {
  const value = callHost<number>(SCALAR_HOST_FN[kind], 0);
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** One raw JSON snapshot (frame / gpu / nodes / input). null when unwired. */
export function readSnapshot(kind: SnapshotKind): Record<string, unknown> | null {
  const value = callHost<Record<string, unknown> | null>(SNAPSHOT_HOST_FN[kind], null);
  return value && typeof value === 'object' ? value : null;
}

function frameRecordFrom(raw: Record<string, unknown>): FrameRecord {
  return {
    fps: Number(raw.fps) || 0,
    tickUs: Number(raw.tick_us) || 0,
    layoutUs: Number(raw.layout_us) || 0,
    paintUs: Number(raw.paint_us) || 0,
    gpuUs: Number(raw.gpu_us) || 0,
    totalUs: Number(raw.frame_total_us) || 0,
    eventUs: Number(raw.event_us) || 0,
    appTickUs: Number(raw.app_tick_us) || 0,
    prePaintUs: Number(raw.pre_paint_us) || 0,
    postFrameUs: Number(raw.post_frame_us) || 0,
    frameNumber: Number(raw.frame_number) || 0,
    gcNs: Number(raw.gc_ns) || 0,
    gcCount: Number(raw.gc_count) || 0,
    gcType: Number(raw.gc_type) || 0,
    presentUs: Number(raw.present_us) || 0,
    bridgeUs: Number(raw.bridge_us) || 0,
  };
}

/** The latest host frame, normalized from the wire's snake_case. null when unwired. */
export function readFrame(): FrameRecord | null {
  const raw = readSnapshot('frame');
  if (!raw) return null;
  return frameRecordFrom(raw);
}

/** GAP-2: the full frame record at history depth n (0 = current, newest first —
 *  same indexing as __tel_history). Lets the report read the SPIKE frame's
 *  latched buckets instead of the recovered current frame. null past the ring or
 *  when the host fn isn't registered (older host → caller falls back to current). */
export function readFrameAt(n: number): FrameRecord | null {
  if (!hasHost('__tel_frame_at')) return null;
  const raw = callHost<Record<string, unknown> | null>('__tel_frame_at', null, n);
  return raw && typeof raw === 'object' ? frameRecordFrom(raw) : null;
}

/** GAP-2: find the LATCHED snapshot of the worst frame, matched by its total
 *  time rather than a raw ring index (the host ring advances a few frames
 *  between tape sampling and this read — host ~240Hz vs JS tick ~60Hz). The
 *  worst frame's total_us fingerprints it in the ring (120 frames ≈ 0.5s; this
 *  runs within ~16ms), so we scan and match — that frame's gc/present/bridge are
 *  exactly what fired during it. null when the host fn is absent. */
export function findSpikeFrameRecord(worstUs: number, depth: number): FrameRecord | null {
  if (!hasHost('__tel_frame_at')) return null;
  const target = Math.round(worstUs);
  let nearest: FrameRecord | null = null;
  for (let n = 0; n <= depth; n++) {
    const r = readFrameAt(n);
    if (!r) break; // past the ring's filled range
    if (Math.round(r.totalUs) === target) return r; // exact spike frame
    if (!nearest || r.totalUs > nearest.totalUs) nearest = r; // best-effort fallback
  }
  return nearest;
}

/** The host's per-frame timing ring: last n frame_total_us values, NEWEST
 *  FIRST, junk filtered. Every host frame lands here even between JS ticks. */
export function readFrameHistory(n: number = TELEMETRY_TUNING.spike.historyFrames): number[] {
  const raw = callHost<unknown>(HISTORY_HOST_FN, null, n);
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const value of raw) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) out.push(num);
  }
  return out;
}

/** The flat diffable counter snapshot (COUNTER_SPEC over the JSON blobs).
 *  Missing host fns / fields simply stay absent — absence is honest. */
export function readCounters(): Counters {
  const out: Counters = {};
  for (const kind of Object.keys(COUNTER_SPEC) as SnapshotKind[]) {
    const snapshot = readSnapshot(kind);
    if (!snapshot) continue;
    for (const key of COUNTER_SPEC[kind]!) {
      const value = Number(snapshot[key]);
      if (Number.isFinite(value)) out[key] = value;
    }
  }
  return out;
}

// ── Panel measurement helpers ───────────────────────────────────────────────

export type FpsTone = 'good' | 'warn' | 'bad';

/** The panel idiom's fps thresholds as a tone — chrome maps tones to colors. */
export function fpsTone(fps: number): FpsTone {
  if (fps >= TELEMETRY_TUNING.panel.fpsGoodAt) return 'good';
  if (fps >= TELEMETRY_TUNING.panel.fpsWarnAt) return 'warn';
  return 'bad';
}

export type SampleRing = {
  push: (value: number) => void;
  /** chronological (oldest → newest) — the sparkline order */
  values: () => number[];
  last: () => number;
  min: () => number;
  max: () => number;
  average: () => number;
  count: () => number;
};

/** A fixed-capacity rolling sample window — the panel's sparkline/avg feed.
 *  Hand it host scalars, GAME_PHYSICS hostMicroseconds, your own loop times. */
export function createSampleRing(capacity: number = TELEMETRY_TUNING.sampler.capacity): SampleRing {
  const cap = Math.max(1, Math.floor(capacity));
  const ring: number[] = [];
  return {
    push: (value: number) => {
      if (!Number.isFinite(value)) return;
      ring.push(value);
      if (ring.length > cap) ring.shift();
    },
    values: () => ring.slice(),
    last: () => (ring.length > 0 ? ring[ring.length - 1] : 0),
    min: () => (ring.length > 0 ? Math.min(...ring) : 0),
    max: () => (ring.length > 0 ? Math.max(...ring) : 0),
    average: () => (ring.length > 0 ? ring.reduce((sum, v) => sum + v, 0) / ring.length : 0),
    count: () => ring.length,
  };
}

/** "4.20ms" / "500us" — microseconds for human eyes. */
export function formatUs(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(2)}ms` : `${value.toFixed(0)}us`;
}

/** Decode V8's GCType bitmask into the human name (the host records the type of
 *  the GC whose pause it timed). */
export function gcTypeName(t: number): string {
  if (t & 4) return 'mark-sweep'; // kGCTypeMarkSweepCompact — the expensive full GC
  if (t & 8) return 'incremental'; // kGCTypeIncrementalMarking
  if (t & 2) return 'minor mark-sweep'; // kGCTypeMinorMarkSweep
  if (t & 1) return 'scavenge'; // kGCTypeScavenge — cheap young-gen
  if (t & 16) return 'weak-callbacks'; // kGCTypeProcessWeakCallbacks
  return 'unknown';
}

/** GC time kept sub-µs honest: ns for a tiny scavenge, µs / ms as it grows. A
 *  floored-to-µs "0us" is the value-ambiguity we are removing. */
export function formatGcTime(gcNs: number): string {
  if (gcNs >= 1_000_000) return `${(gcNs / 1_000_000).toFixed(2)}ms`;
  if (gcNs >= 1_000) return `${(gcNs / 1_000).toFixed(1)}µs`;
  return `${Math.round(gcNs)}ns`;
}

/** The GC bucket label. The count disambiguates a zero time: "×0, never fired"
 *  means the binding produced nothing (chase the registration); "×3" means it
 *  fired and the time — however tiny — is real. */
export function gcLabel(gcNs: number, gcCount: number, gcType: number): string {
  if (gcCount <= 0) return 'V8 GC — (×0, never fired)';
  return `V8 GC ${formatGcTime(gcNs)} (${gcTypeName(gcType)} ×${gcCount})`;
}

/** Name the single largest MEASURED contributor to outside-render ("other")
 *  time. No guessing: GC measured at V8's callbacks, bridge at the Zig→JS
 *  boundary, and whatever neither covers is its own explicit UNATTRIBUTED bucket
 *  (genuinely native: terminal/PTY/physics/scheduling). */
export function attributeOutside(gcNs: number, gcCount: number, gcType: number, bridgeUs: number, unattributedUs: number): string {
  const gcUs = gcNs / 1000;
  const candidates: Array<[string, number]> = [
    [gcLabel(gcNs, gcCount, gcType), gcUs],
    [`NATIVE BRIDGE ${formatUs(bridgeUs)} — Zig→JS app tick / event dispatch`, bridgeUs],
    [`UNATTRIBUTED ${formatUs(unattributedUs)} — native (terminal/PTY/physics/scheduling); not GC, not bridge, not present`, unattributedUs],
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

// ── The spike flight recorder (perfWatch capture) ───────────────────────────
// The symptom this exists for: fps is a 1-second average, so by the time a
// dip is VISIBLE the frame that caused it is long gone. The recorder watches
// the host ring every JS tick and the moment a frame runs much slower than
// the calm baseline it flushes a report — the spike catches itself.

export type SpikeWatchConfig = {
  spikeRatio: number;
  minJumpUs: number;
  cooldownMs: number;
  recorderFrames: number;
  historyFrames: number;
};

let spikeWatchConfig: SpikeWatchConfig = {
  spikeRatio: TELEMETRY_TUNING.spike.spikeRatio,
  minJumpUs: TELEMETRY_TUNING.spike.minJumpUs,
  cooldownMs: TELEMETRY_TUNING.spike.cooldownMs,
  recorderFrames: TELEMETRY_TUNING.spike.recorderFrames,
  historyFrames: TELEMETRY_TUNING.spike.historyFrames,
};
if (gDiag.__hmsc_spike_watch_config) {
  spikeWatchConfig = { ...spikeWatchConfig, ...gDiag.__hmsc_spike_watch_config };
}

export type SpikeDetection = {
  isSpike: boolean;
  baselineUs: number;
  worstUs: number;
};

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The two-gate detector: baseline = median of the ring, spike = worst frame
 *  over BOTH the ratio gate and the absolute-jump gate. Under
 *  minHistorySamples the baseline is meaningless and nothing spikes. */
export function detectSpike(
  historyNewestFirstUs: number[],
  config: Pick<SpikeWatchConfig, 'spikeRatio' | 'minJumpUs'> = TELEMETRY_TUNING.spike,
): SpikeDetection {
  if (historyNewestFirstUs.length < TELEMETRY_TUNING.spike.minHistorySamples) {
    return { isSpike: false, baselineUs: 0, worstUs: 0 };
  }
  const baselineUs = median(historyNewestFirstUs);
  let worstUs = 0;
  for (const value of historyNewestFirstUs) if (value > worstUs) worstUs = value;
  const isSpike =
    baselineUs > 0 && worstUs > baselineUs * config.spikeRatio && worstUs - baselineUs > config.minJumpUs;
  return { isSpike, baselineUs, worstUs };
}

// The classifier's "did __tel_frame carry the spike frame?" gate — fps-implied
// frame time × caughtRatio. (The report line uses the MEASURED baseline for
// the same question; the reference had both, carried faithfully.)
function fpsImpliedCaughtFloor(record: FrameRecord): number {
  return record.fps > 0 ? (1_000_000 / record.fps) * TELEMETRY_TUNING.spike.caughtRatio : 0;
}

/** Turn the phase breakdown + counter deltas into ONE plain-English verdict —
 *  the report names the cause instead of leaving the reader to decode raw
 *  counters. Ordered most-specific first; a heuristic, so the raw deltas
 *  still print below it in the report. */
export function classifySpike(
  record: FrameRecord | null,
  calm: Counters,
  spike: Counters,
  options: { countersReliable?: boolean } = {},
): string {
  const cfg = TELEMETRY_TUNING.classify;
  const countersReliable = options.countersReliable !== false;
  const delta = (key: string): number => {
    const before = calm[key];
    const after = spike[key];
    return before == null || after == null ? 0 : after - before;
  };
  const hashFlipped =
    calm.frame_hash != null && spike.frame_hash != null && calm.frame_hash !== spike.frame_hash;
  const atlasMisses = spike.atlas_miss_count ?? 0;
  const atlasGrew = atlasMisses > 0 ? atlasMisses : delta('atlas_glyph_count');
  const nodeSwing = Math.max(Math.abs(delta('total')), Math.abs(delta('visible')));
  const glyphSwing = Math.abs(delta('glyph_count'));
  const meshSwing = Math.max(Math.abs(delta('scene3d_meshes_collected')), Math.abs(delta('scene3d_instances')));
  const drawSwing = Math.abs(delta('scene3d_draw_calls'));

  // Phase dominance is only trustworthy when __tel_frame actually carries the
  // spike frame (not a recovered post-spike read).
  const caught = record != null && record.totalUs > fpsImpliedCaughtFloor(record);
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

  if (!countersReliable) {
    // Owner counters (node/glyph/rect deltas) are stale here, but the boundary
    // timers live in the (latched) frame record and ARE trustworthy — name the
    // measured cause before falling back to the can't-attribute caveat.
    if (record && gcCount > 0 && gcUs > cfg.gcDominantUsFloor && gcUs >= record.totalUs * cfg.gcDominantFrameFraction) {
      const pct = ((100 * gcUs) / Math.max(1, record.totalUs)).toFixed(0);
      return `WHAT FIRED: ${gcLabel(gcNs, gcCount, gcType)} — measured GC pause; ${pct}% of the frame (owner counters not trusted, but GC time is measured directly).`;
    }
    if (caught && dominant === 'gpu') {
      const presentDominant = presentUs >= record!.gpuUs * cfg.presentDominantGpuFraction;
      const computeUs = Math.max(0, record!.gpuUs - presentUs);
      return presentDominant
        ? `WHAT FIRED: VSYNC / PRESENT WAIT ${formatUs(presentUs)} — measured swapchain acquire + present (display vblank); not a stall.`
        : `WHAT FIRED: GPU DRAW/UPLOAD ${formatUs(computeUs)} compute + ${formatUs(presentUs)} present wait (owner counters not trusted for the delta detail).`;
    }
    if (caught && dominant === 'other') {
      return attributeOutside(gcNs, gcCount, gcType, bridgeUs, unattributedUs);
    }
    if (caught && dominant === 'paint') {
      return 'WHAT FIRED: PAINT SPIKE — latest frame caught the CPU paint cost, but owner counters were not trusted for this report.';
    }
    if (caught && dominant === 'tick') {
      return 'WHAT FIRED: TICK — latest frame caught JS/game logic cost, but owner counters were not trusted for this report.';
    }
    return 'WHAT FIRED: SPIKE IN HOST TAPE — worst frame already recovered before owner counters were sampled; do not attribute stale counter deltas to this spike.';
  }

  // A big node/glyph/mesh swing = a React update mounted/unmounted a subtree.
  // This dominates even when the atlas also grew (the new subtree's text
  // raster is a side effect of the swap, not the headline).
  if (nodeSwing >= cfg.nodeSwingAt || glyphSwing >= cfg.glyphSwingAt || meshSwing >= cfg.meshSwingAt) {
    return `WHAT FIRED: CONTENT SWAP — a React update changed ~${nodeSwing} nodes / ${glyphSwing} glyphs / ${meshSwing} meshes. Something mounted or unmounted; if paint-dominant, that subtree's StaticSurface captures re-baked.`;
  }
  if (atlasGrew >= cfg.atlasGrowthAt) {
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
  // the frame, name it definitively with type instead of guessing.
  if (record && gcCount > 0 && gcUs > cfg.gcDominantUsFloor && gcUs >= record.totalUs * cfg.gcDominantFrameFraction) {
    const pct = ((100 * gcUs) / Math.max(1, record.totalUs)).toFixed(0);
    return `WHAT FIRED: ${gcLabel(gcNs, gcCount, gcType)} — measured at V8's GC prologue/epilogue callbacks; ${pct}% of the frame was this pause.`;
  }
  if (caught && dominant === 'gpu') {
    // present_us is the MEASURED swapchain acquire+present wait (a subset of the
    // gpu phase). If it accounts for most of the gpu phase, the frame was simply
    // vblank-capped (idle), not stalled. Otherwise the gpu time was real
    // encode/upload/draw work.
    const presentDominant = presentUs >= record!.gpuUs * cfg.presentDominantGpuFraction;
    const computeUs = Math.max(0, record!.gpuUs - presentUs);
    if (presentDominant) {
      return `WHAT FIRED: VSYNC / PRESENT WAIT ${formatUs(presentUs)} — measured wait on swapchain acquire + present (display vblank). Not a stall; the frame was idle-capped at the refresh rate (${computeUs > 0 ? `${formatUs(computeUs)} actual GPU work` : 'no GPU work'}).`;
    }
    return `WHAT FIRED: GPU DRAW/UPLOAD ${formatUs(computeUs)} compute + ${formatUs(presentUs)} present wait${drawSwing ? ` (draw calls ${delta('scene3d_draw_calls') >= 0 ? '+' : ''}${delta('scene3d_draw_calls')})` : ''}.`;
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

function recentReconChurnLines(): string[] {
  const dump = (globalThis as any).__RECON_CHURN_DUMP;
  if (typeof dump !== 'function') return [];
  let snapshots: unknown;
  try { snapshots = dump(); } catch { return []; }
  if (!Array.isArray(snapshots) || snapshots.length === 0) return [];
  const now = Date.now();
  const fresh = snapshots.filter((snap) => {
    if (!snap || typeof snap !== 'object') return false;
    const at = Number((snap as { at?: unknown }).at);
    return Number.isFinite(at) && now - at <= 1200;
  });
  if (fresh.length === 0) return [];
  const lines: string[] = [];
  for (const snap of fresh.slice(-4)) {
    if (!snap || typeof snap !== 'object') continue;
    const s = snap as { commit?: unknown; events?: unknown; nodes?: unknown; glyphs?: unknown; parts?: unknown };
    lines.push(`  commit=${String(s.commit ?? '?')} events=${String(s.events ?? '?')} nodes=${String(s.nodes ?? '?')} glyphs=${String(s.glyphs ?? '?')}`);
    if (Array.isArray(s.parts)) {
      for (const part of s.parts.slice(0, 4)) lines.push(`    ${String(part)}`);
    }
  }
  return lines;
}

function readTextTrace(): string {
  const gpu = readSnapshot('gpu');
  const trace = gpu?.text_trace;
  return typeof trace === 'string' ? trace : '';
}

function readStaticCaptureTrace(): string {
  const gpu = readSnapshot('gpu');
  const trace = gpu?.static_capture_trace;
  return typeof trace === 'string' ? trace : '';
}

export type SpikeReportInput = {
  historyNewestFirstUs: number[];
  baselineUs: number;
  worstUs: number;
  calmCounters: Counters;
  spikeCounters: Counters;
  counterFrameCaught?: boolean;
  record: FrameRecord | null;
  // GAP-2: true when `record` is the worst frame's LATCHED host-ring snapshot
  // (matched by total time), not the recovered current frame. Drives the
  // "SPIKE FRAME CAUGHT (latched)" label and means the buckets are the spike's.
  latched?: boolean;
  calmTextTrace?: string;
  spikeTextTrace?: string;
  calmStaticCaptureTrace?: string;
  spikeStaticCaptureTrace?: string;
  recorderFrames?: number;
};

/** One spike → one multi-line report, built to be scanned top-to-bottom:
 *  what fired, how bad, which phase, what moved, the tape. Pure — the watch
 *  loop reads the host then hands everything here. */
export function buildSpikeReport(input: SpikeReportInput): string[] {
  const { baselineUs, worstUs, calmCounters, spikeCounters, record } = input;
  const counterFrameCaught = input.counterFrameCaught !== false;
  const lines: string[] = [];
  lines.push('──────── GAME PERF SPIKE ────────');
  lines.push(classifySpike(record, calmCounters, spikeCounters, { countersReliable: counterFrameCaught }));
  lines.push(
    `worst ${formatUs(worstUs)}  baseline ${formatUs(baselineUs)}  (+${formatUs(worstUs - baselineUs)}, ${baselineUs > 0 ? (worstUs / baselineUs).toFixed(2) : '?'}x)` +
      `  ~${baselineUs > 0 ? Math.round(1_000_000 / baselineUs) : 0}fps → ~${worstUs > 0 ? Math.round(1_000_000 / worstUs) : 0}fps`,
  );

  if (record) {
    const known = record.tickUs + record.layoutUs + record.paintUs + record.gpuUs;
    const other = Math.max(0, record.totalUs - known);
    // With a latched record we KNOW it's the spike frame (matched by total time
    // in the host ring). Without it, fall back to the recovered-frame heuristic.
    const latched = input.latched === true;
    const caughtSpike = latched || record.totalUs > baselineUs * TELEMETRY_TUNING.spike.caughtRatio;
    const dominant = record.paintUs >= record.gpuUs ? 'paint (CPU raster / atlas)' : 'gpu (upload/draw)';
    lines.push(
      caughtSpike
        ? `SPIKE FRAME CAUGHT${latched ? ' (latched from host ring)' : ''} — dominant phase: ${dominant}`
        : 'spike already recovered; phases below are a post-spike frame (worst frame came from the tape)',
    );
    lines.push(
      `${latched ? 'spike' : 'latest'} frame phases: tick ${formatUs(record.tickUs)}  layout ${formatUs(record.layoutUs)}  ` +
        `paint ${formatUs(record.paintUs)}  gpu ${formatUs(record.gpuUs)}  other ${formatUs(other)}  (total ${formatUs(record.totalUs)})`,
    );
    // Outside-render breakdown, each MEASURED at its real boundary (not inferred
    // by subtraction). The buckets sum honestly: bridge + unattributed ≈ other
    // (present is inside the gpu phase, GC is frame-wide and may overlap any).
    const unattributed = Math.max(0, other - record.bridgeUs);
    lines.push(
      `outside-render attribution: ${gcLabel(record.gcNs, record.gcCount, record.gcType)} (frame-wide)  |  ` +
        `present/vsync ${formatUs(record.presentUs)} (within gpu)  |  ` +
        `bridge ${formatUs(record.bridgeUs)} (Zig→JS, within other)  |  ` +
        `unattributed ${formatUs(unattributed)} (native, within other)`,
    );
  }

  // Counter deltas — the diagnostic payload. Only print what actually moved.
  const moved: string[] = [];
  const keys = new Set<string>([...Object.keys(calmCounters), ...Object.keys(spikeCounters)]);
  for (const key of keys) {
    const before = calmCounters[key];
    const after = spikeCounters[key];
    if (before === after) continue;
    if (before == null || after == null) continue;
    const delta = after - before;
    const sign = delta > 0 ? '+' : '';
    moved.push(`${key} ${before}→${after} (${sign}${delta})`);
  }
  if (moved.length > 0) {
    lines.push(`${counterFrameCaught ? 'changed across spike' : 'latest recovered-frame diff vs last clean frame'}: ${moved.join('  |  ')}`);
    if (
      calmCounters.frame_hash != null &&
      spikeCounters.frame_hash != null &&
      calmCounters.frame_hash !== spikeCounters.frame_hash
    ) {
      lines.push(
        counterFrameCaught
          ? '  ^ frame_hash flipped → 2D draw data changed → full GPU re-upload (a React update / StaticSurface rebake landed this frame).'
          : '  ^ frame_hash differs on the recovered frame; this is NOT proof that the hash flip landed on the worst frame.',
      );
    }
  } else {
    lines.push(
      counterFrameCaught
        ? 'changed across spike: nothing in our draw counters moved — see the outside-render attribution line above for the measured cause (GC / present / bridge / native).'
        : 'changed across spike: not captured — latest telemetry had already recovered, so owner counters were refreshed instead of attributed.',
    );
  }

  const calmTextTrace = input.calmTextTrace ?? '';
  const spikeTextTrace = input.spikeTextTrace ?? '';
  if (counterFrameCaught && (calmTextTrace || spikeTextTrace)) {
    if (calmTextTrace !== spikeTextTrace) {
      lines.push('text trace changed across spike:');
      if (calmTextTrace) lines.push(`  calm: ${calmTextTrace}`);
      if (spikeTextTrace) lines.push(`  spike: ${spikeTextTrace}`);
    } else if (
      calmCounters.text_hash != null &&
      spikeCounters.text_hash != null &&
      calmCounters.text_hash !== spikeCounters.text_hash
    ) {
      lines.push(`text trace unchanged but text_hash flipped: ${spikeTextTrace}`);
    }
  }

  const calmStaticCaptureTrace = input.calmStaticCaptureTrace ?? '';
  const spikeStaticCaptureTrace = input.spikeStaticCaptureTrace ?? '';
  if (counterFrameCaught && (calmStaticCaptureTrace || spikeStaticCaptureTrace)) {
    if (calmStaticCaptureTrace !== spikeStaticCaptureTrace) {
      lines.push('static capture trace changed across spike:');
      if (calmStaticCaptureTrace) lines.push(`  calm: ${calmStaticCaptureTrace}`);
      if (spikeStaticCaptureTrace) lines.push(`  spike: ${spikeStaticCaptureTrace}`);
    } else if ((spikeCounters.static_capture_count ?? 0) > 0) {
      lines.push(`static capture trace unchanged: ${spikeStaticCaptureTrace}`);
    }
  }

  const atlasMisses = spikeCounters.atlas_miss_count ?? 0;
  const atlasGrew = atlasMisses > 0
    ? atlasMisses
    : (spikeCounters.atlas_glyph_count ?? 0) - (calmCounters.atlas_glyph_count ?? 0);
  const nodeSwing = Math.max(
    Math.abs((spikeCounters.total ?? 0) - (calmCounters.total ?? 0)),
    Math.abs((spikeCounters.visible ?? 0) - (calmCounters.visible ?? 0)),
  );
  const glyphSwing = Math.abs((spikeCounters.glyph_count ?? 0) - (calmCounters.glyph_count ?? 0));
  const shouldAttachOwnerTrace =
    counterFrameCaught &&
    (
      atlasGrew >= TELEMETRY_TUNING.classify.atlasGrowthAt ||
      nodeSwing >= TELEMETRY_TUNING.classify.nodeSwingAt ||
      glyphSwing >= TELEMETRY_TUNING.classify.glyphSwingAt
    );
  if (shouldAttachOwnerTrace) {
    const churn = recentReconChurnLines();
    if (churn.length > 0) {
      lines.push(`recon owner trace (recent text/font-size mutations; atlas +${atlasGrew}, nodes ~${nodeSwing}, glyphs ${glyphSwing}):`);
      lines.push(...churn);
    } else {
      lines.push(`recon owner trace: no recent records — run gv_churntrace 1 before waiting for the next CONTENT SWAP / GLYPH RASTERIZE spike.`);
    }
  }

  // Flight-recorder tape: recent frame times newest-first, in ms, so the
  // SHAPE of the dip is visible (one fat frame vs a sustained sag).
  const tapeLength = input.recorderFrames ?? TELEMETRY_TUNING.spike.recorderFrames;
  const tape = input.historyNewestFirstUs.slice(0, tapeLength).map((v) => (v / 1000).toFixed(1)).join(' ');
  lines.push(`tape (ms, newest first): ${tape}`);
  lines.push('─────────────────────────────────');
  return lines;
}

// console.log (severity 0) only lands in an in-memory ring — it never reaches
// a terminal. Only warn/error write to stderr, so every line the recorder
// wants SEEN goes through console.warn.
function emitLine(text: string): void {
  globalThis.console?.warn?.(text);
}

let watchRunning = false;
let activeSpikeWatchStop: (() => void) | null = null;

export function configureSpikeWatch(patch: Partial<SpikeWatchConfig>): SpikeWatchConfig {
  spikeWatchConfig = { ...spikeWatchConfig, ...patch };
  gDiag.__hmsc_spike_watch_config = { ...spikeWatchConfig };
  return { ...spikeWatchConfig };
}

export function spikeWatchStatusLine(enabled: boolean): string {
  return (
    `perflog = ${enabled ? '1' : '0'}  ` +
    `spikeRatio ${spikeWatchConfig.spikeRatio}  minJump ${(spikeWatchConfig.minJumpUs / 1000).toFixed(2)}ms  ` +
    `cooldown ${spikeWatchConfig.cooldownMs}ms  tape ${spikeWatchConfig.recorderFrames}`
  );
}

export function stopSpikeWatch(): void {
  gDiag.__hmsc_spike_watch_enabled = false;
  gDiag.__hmsc_spike_watch_stop = undefined;
  activeSpikeWatchStop?.();
}

/**
 * Start the spike flight recorder. Idempotent; returns a stop fn. Rides the
 * setTimeout fallback at ~60Hz when the host has no requestAnimationFrame
 * (this host doesn't) — fine, because the host ring carries every frame
 * between our ticks. The console-command toggle (hmsc's `gv_perflog`) is a
 * GAME_COMMANDS registration the console route owns, not this module.
 */
export function startSpikeWatch(patch: Partial<SpikeWatchConfig> = {}): () => void {
  if (Object.keys(patch).length > 0) configureSpikeWatch(patch);
  if (watchRunning) return activeSpikeWatchStop ?? (() => {});
  watchRunning = true;
  gDiag.__hmsc_spike_watch_enabled = true;

  const raf = globalThis.requestAnimationFrame as ((fn: () => void) => unknown) | undefined;
  const timeout = (globalThis as any).setTimeout as (((fn: () => void, ms: number) => unknown) | undefined);
  if (typeof raf !== 'function' && typeof timeout !== 'function') {
    recordDiagnostic('spikes', 'timer-unavailable');
    watchRunning = false;
    return () => {};
  }
  const schedule = typeof raf === 'function' ? raf.bind(globalThis) : (fn: () => void) => timeout!(fn, 16);
  const cancelRaf = globalThis.cancelAnimationFrame as ((handle: unknown) => void) | undefined;
  const clear = (globalThis as any).clearTimeout as (((handle: unknown) => void) | undefined);
  const cancel = typeof cancelRaf === 'function' ? cancelRaf.bind(globalThis) : (typeof clear === 'function' ? clear : (_handle: unknown) => {});

  let handle: unknown = 0;
  let stopped = false;
  let armed = false;
  let lastFlushAt = 0;
  let calmCounters = readCounters();
  let calmTextTrace = readTextTrace();
  let calmStaticCaptureTrace = readStaticCaptureTrace();
  const now = (): number => Date.now();

  const tick = () => {
    if (stopped) return;
    const config = spikeWatchConfig;
    const history = readFrameHistory(config.historyFrames);
    const detection = detectSpike(history, config);
    const latestRecord = readFrame();
    const latestCaughtSpike =
      latestRecord != null &&
      detection.baselineUs > 0 &&
      latestRecord.totalUs > detection.baselineUs * TELEMETRY_TUNING.spike.caughtRatio;
    const latestCounters = readCounters();
    const latestTextTrace = readTextTrace();
    const latestStaticCaptureTrace = readStaticCaptureTrace();
    if (history.length >= TELEMETRY_TUNING.spike.minHistorySamples) {
      // One-shot heartbeat: confirms the recorder is sampling AND that warn-
      // level logs reach this terminal. Never see it → telemetry isn't wired
      // or you're watching the wrong terminal.
      if (!armed) {
        armed = true;
        recordDiagnostic('spikes', 'armed', { baselineUs: detection.baselineUs, samples: history.length });
        emitLine(
          `[spikewatch] armed — baseline ~${formatUs(detection.baselineUs)} (~${detection.baselineUs > 0 ? Math.round(1_000_000 / detection.baselineUs) : 0}fps). ` +
            `Will flush on frames > ${config.spikeRatio}x baseline. Go idle and wait for GAME PERF SPIKE.`,
        );
      }
      if (detection.isSpike) {
        const t = now();
        if (t - lastFlushAt > config.cooldownMs) {
          // GAP-2: pull the worst frame's LATCHED snapshot (its buckets are what
          // fired during the spike), falling back to the current frame when the
          // host can't supply it. counterFrameCaught stays true when latched —
          // we now have the real spike frame, so its buckets are trustworthy.
          const spikeFrame = findSpikeFrameRecord(detection.worstUs, Math.min(history.length + 8, 120));
          const reportRecord = spikeFrame ?? latestRecord;
          const lines = buildSpikeReport({
            historyNewestFirstUs: history,
            baselineUs: detection.baselineUs,
            worstUs: detection.worstUs,
            calmCounters,
            spikeCounters: latestCounters,
            counterFrameCaught: spikeFrame != null ? true : latestCaughtSpike,
            calmTextTrace,
            spikeTextTrace: latestTextTrace,
            calmStaticCaptureTrace,
            spikeStaticCaptureTrace: latestStaticCaptureTrace,
            record: reportRecord,
            latched: spikeFrame != null,
            recorderFrames: config.recorderFrames,
          });
          recordDiagnostic('spikes', 'spike', {
            baselineUs: detection.baselineUs,
            worstUs: detection.worstUs,
            samples: history.length,
            report: lines.join('\n'),
          });
          emitLine(lines.join('\n'));
          lastFlushAt = t;
        }
      }
      if (!detection.isSpike || !latestCaughtSpike) {
        // Keep a fresh pre-spike snapshot whenever the latest frame is calm.
        // The host history can still contain an old worst frame for a while;
        // those recovered ticks must not keep reusing stale "calm" counters.
        calmCounters = latestCounters;
        calmTextTrace = latestTextTrace;
        calmStaticCaptureTrace = latestStaticCaptureTrace;
      }
    }
    handle = schedule(tick);
  };

  handle = schedule(tick);
  const stop = () => {
    stopped = true;
    watchRunning = false;
    activeSpikeWatchStop = null;
    if (gDiag.__hmsc_spike_watch_stop === stop) gDiag.__hmsc_spike_watch_stop = undefined;
    (cancel as (h: unknown) => void)(handle);
  };
  activeSpikeWatchStop = stop;
  gDiag.__hmsc_spike_watch_stop = stop;
  return stop;
}

const rehydrateSpikeWatch =
  gDiag.__hmsc_spike_watch_enabled === true ||
  diagnosticChannelEnabled('spikes') === true;
if (rehydrateSpikeWatch) {
  const timer = (globalThis as any).setTimeout;
  const rearm = () => {
    diagnosticEnabled.spikes = true;
    startSpikeWatch();
  };
  if (typeof timer === 'function') timer(rearm, 0);
  else rearm();
}

// ── Copy-diagnostics (the button's working half) ────────────────────────────

export type DiagnosticsSnapshot = {
  label: string;
  capturedAt: string;
  availability: TelemetryAvailability;
  scalars: Record<ScalarKind, number>;
  telemetry: Record<SnapshotKind, Record<string, unknown> | null>;
  tapeUs: number[];
  [extra: string]: unknown;
};

/**
 * The full diagnostic snapshot: label + timestamp + every telemetry blob +
 * the frame tape + whatever domain blocks the lab adds (world params, camera
 * state, GAME_PHYSICS hostMicroseconds, …) via `extra`. Extra keys land at
 * the top level and win on collision — the caller is describing their lab.
 */
export function buildDiagnostics(label: string, extra: Record<string, unknown> = {}): DiagnosticsSnapshot {
  return {
    label,
    capturedAt: new Date().toISOString(),
    availability: availability(),
    scalars: {
      fps: readScalar('fps'),
      layoutUs: readScalar('layoutUs'),
      paintUs: readScalar('paintUs'),
      tickUs: readScalar('tickUs'),
      nodeCount: readScalar('nodeCount'),
    },
    telemetry: {
      frame: readSnapshot('frame'),
      gpu: readSnapshot('gpu'),
      nodes: readSnapshot('nodes'),
      input: readSnapshot('input'),
      hostFlush: readSnapshot('hostFlush'),
    },
    tapeUs: readFrameHistory(TELEMETRY_TUNING.diagnostics.tapeFrames),
    ...extra,
  };
}

/** Pretty JSON — what lands on the clipboard / in a bug report. */
export function serializeDiagnostics(snapshot: DiagnosticsSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

/**
 * Build + serialize + copy to the system clipboard. Returns whether the
 * clipboard host fn existed — the button renders "copied" vs "copy failed"
 * off this. (Calls the `__clipboard_set` wire directly: the runtime clipboard
 * module's import side-effect registers IFTTT verbs, which a measurement
 * module has no business pulling into every game cart.)
 */
export function copyDiagnostics(label: string, extra: Record<string, unknown> = {}): boolean {
  if (!hasHost(CLIPBOARD_HOST_FN)) return false;
  callHost<void>(CLIPBOARD_HOST_FN, undefined as never, serializeDiagnostics(buildDiagnostics(label, extra)));
  return true;
}

// ── THE DOOR ────────────────────────────────────────────────────────────────

export const GAME_TELEMETRY = Object.freeze({
  // measurement reads
  availability,
  readScalar,
  readSnapshot,
  readFrame,
  readFrameAt,
  findSpikeFrameRecord,
  readFrameHistory,
  readCounters,
  // panel measurement helpers (chrome renders; this measures)
  fpsTone,
  createSampleRing,
  formatUs,
  formatGcTime,
  gcTypeName,
  gcLabel,
  attributeOutside,
  // the spike flight recorder
  median,
  detectSpike,
  classifySpike,
  buildSpikeReport,
  configureSpikeWatch,
  spikeWatchStatusLine,
  startSpikeWatch,
  stopSpikeWatch,
  // runtime diagnostics channels (PERFLOG-0605)
  channels: DIAGNOSTIC_CHANNELS,
  isDiagnosticChannel,
  diagnosticChannelEnabled,
  diagnosticToggles,
  diagnosticStatus,
  setDiagnosticChannel,
  recordDiagnostic,
  flushDiagnosticChannel,
  flushDiagnostics,
  clearDiagnostics,
  diagnosticDump,
  estimateDiagnosticOffOverhead,
  // copy-diagnostics
  buildDiagnostics,
  serializeDiagnostics,
  copyDiagnostics,
  // the knob surface
  tuning: TELEMETRY_TUNING,
});
