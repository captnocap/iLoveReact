import { useEffect, useState } from 'react';
import { Icon } from '../../../runtime/icons/Icon';
import { useTelemetry } from '../../../runtime/hooks/useTelemetry';
import { C, accentFor } from '../workspace.cls';
import { formatMs } from '../data/telemetry';
import { formatBytes, formatCount } from '../data/readouts';
import DiagnosticConsumerRow from './DiagnosticConsumerRow';
import type { DiagnosticConsumer as Consumer } from './diagnosticConsumers';

type FrameTelemetry = {
  fps?: number;
  frame_total_us?: number;
  event_us?: number;
  app_tick_us?: number;
  pre_layout_us?: number;
  layout_us?: number;
  pre_paint_us?: number;
  paint_us?: number;
  gpu_us?: number;
  post_frame_us?: number;
  bridge_us?: number;
  present_us?: number;
  gc_ns?: number;
  gc_count?: number;
  bridge_calls_per_sec?: number;
};

type GpuTelemetry = {
  rect_count?: number;
  glyph_count?: number;
  atlas_miss_count?: number;
  static_capture_count?: number;
  scene3d_instances?: number;
  scene3d_draw_calls?: number;
  scene3d_triangles?: number;
  scene3d_draw_us?: number;
  frames_since_drain?: number;
};

type NodeTelemetry = {
  total?: number;
  visible?: number;
  text?: number;
  image?: number;
  pressable?: number;
  scroll?: number;
  max_depth?: number;
};

type HostFlushTelemetry = {
  queued_batches?: number;
  queued_bytes?: number;
  last_drain_batches?: number;
  last_drain_bytes?: number;
  last_drain_us?: number;
  total_enqueued_batches?: number;
  total_drained_batches?: number;
};

type RenderStat = {
  id: string;
  commits: number;
  updates: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
  lastMs: number;
  lastPhase: string;
};

type RenderSnapshot = {
  summary?: {
    regions: number;
    commits: number;
    updates: number;
    totalMs: number;
    maxMs: number;
  };
  top?: RenderStat[];
};

type EffectStat = {
  owner: string;
  hookKind: string;
  totalMs?: number;
  avgMs?: number;
  runCount: number;
  cleanupMs?: number;
  cleanupCount?: number;
  depFlips?: Record<string, number>;
};

type JsChurnSnapshot = {
  renders: RenderSnapshot;
  effects: EffectStat[];
  effectsByRuns: EffectStat[];
};

type Bucket = {
  id: string;
  label: string;
  ms: number;
  note: string;
};

const EMPTY_CHURN: JsChurnSnapshot = { renders: { top: [], summary: undefined }, effects: [], effectsByRuns: [] };

function readJsChurn(): JsChurnSnapshot {
  const g = globalThis as any;
  const renders = typeof g.__getRenderStats === 'function' ? g.__getRenderStats(10) : { top: [], summary: undefined };
  const effects = typeof g.__getTopEffects === 'function' ? g.__getTopEffects(8) : [];
  const effectsByRuns = typeof g.__getTopEffectsByRunCount === 'function' ? g.__getTopEffectsByRunCount(8) : [];
  return { renders, effects, effectsByRuns };
}

function useJsChurn(): JsChurnSnapshot {
  const [snapshot, setSnapshot] = useState<JsChurnSnapshot>(() => readJsChurn());
  useEffect(() => {
    const read = () => setSnapshot(readJsChurn());
    read();
    const handle = setInterval(read, 500);
    return () => clearInterval(handle);
  }, []);
  return snapshot;
}

function msFromUs(value: number | undefined): number {
  return value ? value / 1000 : 0;
}

function msFromNs(value: number | undefined): number {
  return value ? value / 1000000 : 0;
}

function frameBuckets(frame: FrameTelemetry | null): Bucket[] {
  return [
    { id: 'event', label: 'events', ms: msFromUs(frame?.event_us), note: 'input/event dispatch before app work' },
    { id: 'app', label: 'app tick', ms: msFromUs(frame?.app_tick_us), note: 'JS timers, scheduler, React work' },
    { id: 'preLayout', label: 'pre-layout', ms: msFromUs(frame?.pre_layout_us), note: 'host prep before layout' },
    { id: 'layout', label: 'layout', ms: msFromUs(frame?.layout_us), note: 'layout solve over node tree' },
    { id: 'prePaint', label: 'pre-paint', ms: msFromUs(frame?.pre_paint_us), note: 'host prep before paint walk' },
    { id: 'paint', label: 'paint', ms: msFromUs(frame?.paint_us), note: 'CPU paint walk / draw command emission' },
    { id: 'gpu', label: 'gpu', ms: msFromUs(frame?.gpu_us), note: 'encode, submit, render, present path' },
    { id: 'post', label: 'post-frame', ms: msFromUs(frame?.post_frame_us), note: 'after-present cleanup' },
  ].sort((a, b) => b.ms - a.ms);
}

function secondaryBuckets(frame: FrameTelemetry | null, hostFlush: HostFlushTelemetry | null): Bucket[] {
  return [
    { id: 'bridge', label: 'bridge', ms: msFromUs(frame?.bridge_us), note: `${formatCount(frame?.bridge_calls_per_sec ?? 0)} calls/sec` },
    { id: 'present', label: 'present', ms: msFromUs(frame?.present_us), note: 'vsync/swapchain wait inside gpu bucket' },
    { id: 'gc', label: 'gc', ms: msFromNs(frame?.gc_ns), note: `${frame?.gc_count ?? 0} collections this frame` },
    { id: 'flush', label: 'host flush', ms: msFromUs(hostFlush?.last_drain_us), note: `${hostFlush?.last_drain_batches ?? 0} batches, ${formatBytes(hostFlush?.last_drain_bytes)}` },
  ].sort((a, b) => b.ms - a.ms);
}

function causeFor(bucket: Bucket | undefined): string {
  if (!bucket || bucket.ms <= 0) return 'idle / below sample threshold';
  if (bucket.id === 'app') return 'JS/React churn is the dominant frame bucket';
  if (bucket.id === 'layout') return 'layout work is dominating this frame';
  if (bucket.id === 'paint') return 'paint traversal or draw command emission is dominating';
  if (bucket.id === 'gpu') return 'GPU/submit/present path is dominating';
  if (bucket.id === 'event') return 'input/event dispatch is currently dominant';
  return `${bucket.label} is the largest measured bucket`;
}

function pressureConsumer(
  rows: Consumer[],
  id: string,
  source: string,
  label: string,
  count: number | undefined,
  divisor: number,
  threshold: number,
  detail: string,
) {
  const value = Math.max(0, Math.round(count ?? 0));
  if (value < threshold) return;
  rows.push({
    id,
    source,
    label,
    value: formatCount(value),
    detail,
    score: value / divisor,
    hot: value >= threshold * 2,
  });
}

function rankedConsumers(args: {
  buckets: Bucket[];
  secondary: Bucket[];
  gpu: GpuTelemetry | null;
  nodes: NodeTelemetry | null;
  renderSummary: RenderSnapshot['summary'];
  renderStats: RenderStat[];
  topEffect: EffectStat | undefined;
}): Consumer[] {
  const rows: Consumer[] = [];
  for (const bucket of args.buckets) {
    if (bucket.ms <= 0) continue;
    rows.push({
      id: `frame:${bucket.id}`,
      source: 'frame',
      label: bucket.label,
      value: formatMs(bucket.ms),
      detail: bucket.note,
      score: bucket.ms,
      hot: bucket.ms >= 12,
    });
  }
  for (const bucket of args.secondary) {
    if (bucket.ms <= 0) continue;
    rows.push({
      id: `secondary:${bucket.id}`,
      source: 'signal',
      label: bucket.label,
      value: formatMs(bucket.ms),
      detail: bucket.note,
      score: bucket.ms,
      hot: bucket.ms >= 8,
    });
  }

  const topRenderByTime = [...args.renderStats].sort((a, b) => Math.max(b.maxMs, b.totalMs) - Math.max(a.maxMs, a.totalMs))[0];
  if (topRenderByTime && Math.max(topRenderByTime.maxMs, topRenderByTime.totalMs) > 0) {
    rows.push({
      id: `render-time:${topRenderByTime.id}`,
      source: 'React',
      label: topRenderByTime.id,
      value: formatMs(topRenderByTime.maxMs),
      detail: `${topRenderByTime.updates} updates · ${formatMs(topRenderByTime.totalMs)} total render time`,
      score: Math.max(topRenderByTime.maxMs, topRenderByTime.totalMs / Math.max(1, topRenderByTime.commits)),
      hot: topRenderByTime.maxMs >= 8,
    });
  }

  const topRenderByUpdates = [...args.renderStats].sort((a, b) => b.updates - a.updates)[0];
  if (topRenderByUpdates && topRenderByUpdates.updates > 0) {
    rows.push({
      id: `render-updates:${topRenderByUpdates.id}`,
      source: 'React',
      label: 'render churn',
      value: formatCount(topRenderByUpdates.updates),
      detail: `${topRenderByUpdates.id} update commits since reset`,
      score: topRenderByUpdates.updates / 1000,
      hot: topRenderByUpdates.updates >= 5000,
    });
  } else if (args.renderSummary?.updates) {
    rows.push({
      id: 'render-updates:summary',
      source: 'React',
      label: 'render churn',
      value: formatCount(args.renderSummary.updates),
      detail: `${args.renderSummary.regions} probes reporting updates`,
      score: args.renderSummary.updates / 1200,
      hot: args.renderSummary.updates >= 6000,
    });
  }

  if (args.topEffect) {
    const totalMs = args.topEffect.totalMs ?? 0;
    rows.push({
      id: `effect:${args.topEffect.owner}:${args.topEffect.hookKind}`,
      source: 'effect',
      label: args.topEffect.owner,
      value: totalMs > 0 ? formatMs(totalMs) : `${formatCount(args.topEffect.runCount)} runs`,
      detail: `${args.topEffect.hookKind} · ${flipSummary(args.topEffect)}`,
      score: Math.max(totalMs, args.topEffect.runCount / 20),
      hot: totalMs >= 8 || args.topEffect.runCount >= 200,
    });
  }

  const scene3dMs = msFromUs(args.gpu?.scene3d_draw_us);
  if (scene3dMs > 0) {
    rows.push({
      id: 'gpu:scene3d',
      source: 'gpu',
      label: '3d draw',
      value: formatMs(scene3dMs),
      detail: `${formatCount(args.gpu?.scene3d_draw_calls ?? 0)} calls · ${formatCount(args.gpu?.scene3d_triangles ?? 0)} triangles`,
      score: scene3dMs,
      hot: scene3dMs >= 8,
    });
  }

  pressureConsumer(rows, 'gpu:static-capture', 'capture', 'static captures', args.gpu?.static_capture_count, 1, 1, 'StaticSurface captures/re-bakes this frame');
  pressureConsumer(rows, 'gpu:atlas-miss', 'glyph', 'atlas misses', args.gpu?.atlas_miss_count, 0.5, 1, 'glyph/image atlas misses force extra paint/cache work');
  pressureConsumer(rows, 'gpu:rects', 'draw', 'rect draws', args.gpu?.rect_count, 60, 240, '2D rectangle draw command pressure');
  pressureConsumer(rows, 'gpu:glyphs', 'draw', 'glyph draws', args.gpu?.glyph_count, 180, 600, 'text glyph draw command pressure');
  pressureConsumer(rows, 'nodes:visible', 'tree', 'visible nodes', args.nodes?.visible, 300, 1200, 'visible node tree traversed by layout/paint');
  pressureConsumer(rows, 'nodes:text', 'tree', 'text nodes', args.nodes?.text, 180, 450, 'text nodes can drive glyph and layout cost');

  const deduped = new Map<string, Consumer>();
  for (const row of rows) {
    const prior = deduped.get(row.id);
    if (!prior || row.score > prior.score) deduped.set(row.id, row);
  }

  return Array.from(deduped.values())
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 16);
}

function consumerSignature(consumers: Consumer[]): string {
  return consumers.map((consumer) => `${consumer.id}:${consumer.score}:${consumer.value}`).join('|');
}

function mergePeakConsumers(current: Consumer[], peaks: Record<string, Consumer>): Consumer[] {
  const merged = new Map<string, Consumer>();
  for (const consumer of current) merged.set(consumer.id, consumer);
  for (const peak of Object.values(peaks)) {
    const live = merged.get(peak.id);
    if (!live || peak.score > live.score) {
      merged.set(peak.id, {
        ...peak,
        source: 'peak',
        detail: live ? `peak since reset; current ${live.value} · ${peak.detail}` : `peak since reset · ${peak.detail}`,
      });
    }
  }
  return Array.from(merged.values()).sort((a, b) => b.score - a.score).slice(0, 16);
}

function flipSummary(stat: EffectStat): string {
  const flips = stat.depFlips ?? {};
  const parts = Object.keys(flips)
    .sort((a, b) => (flips[b] ?? 0) - (flips[a] ?? 0))
    .slice(0, 3)
    .map((key) => `d${key}:${flips[key]}`);
  return parts.length ? parts.join(' ') : 'deps stable/unknown';
}

function resetChurn() {
  const g = globalThis as any;
  if (typeof g.__resetRenderStats === 'function') g.__resetRenderStats();
  if (typeof g.__resetEffectStats === 'function') g.__resetEffectStats();
}

function BucketRow({ bucket, maxMs }: { bucket: Bucket; maxMs: number }) {
  const pct = maxMs > 0 ? Math.max(2, Math.min(100, (bucket.ms / maxMs) * 100)) : 0;
  return (
    <C.HW_ChurnRow>
      <C.HW_KeyText style={{ width: 58 }}>{bucket.label}</C.HW_KeyText>
      <C.HW_ChurnBar><C.HW_ChurnFill style={{ width: `${pct}%`, backgroundColor: bucket.ms > 8 ? accentFor('warning') : accentFor('primary') }} /></C.HW_ChurnBar>
      <C.HW_DockValue style={{ width: 58, textAlign: 'right' }}>{formatMs(bucket.ms)}</C.HW_DockValue>
    </C.HW_ChurnRow>
  );
}

export default function PerformancePopover({ onClose }: { onClose: () => void }) {
  const { data: frame } = useTelemetry<FrameTelemetry>({ kind: 'frame', pollMs: 500 });
  const { data: gpu } = useTelemetry<GpuTelemetry>({ kind: 'gpu', pollMs: 500 });
  const { data: nodes } = useTelemetry<NodeTelemetry>({ kind: 'nodes', pollMs: 500 });
  const { data: hostFlush } = useTelemetry<HostFlushTelemetry>({ kind: 'hostFlush', pollMs: 500 });
  const js = useJsChurn();
  const buckets = frameBuckets(frame);
  const secondary = secondaryBuckets(frame, hostFlush);
  const dominant = buckets[0];
  const maxBucket = Math.max(1, ...buckets.map((bucket) => bucket.ms));
  const renderSummary = js.renders.summary;
  const renderStats = js.renders.top ?? [];
  const topRender = js.renders.top?.[0];
  const topEffect = js.effects[0] ?? js.effectsByRuns[0];
  const consumers = rankedConsumers({ buckets, secondary, gpu, nodes, renderSummary, renderStats, topEffect });
  const [peakConsumers, setPeakConsumers] = useState<Record<string, Consumer>>({});
  const consumersKey = consumerSignature(consumers);

  useEffect(() => {
    setPeakConsumers((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const consumer of consumers) {
        if (!next[consumer.id] || consumer.score > next[consumer.id]!.score) {
          next[consumer.id] = consumer;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [consumersKey]);

  const ranked = mergePeakConsumers(consumers, peakConsumers);
  const maxConsumer = Math.max(1, ...ranked.map((consumer) => consumer.score));
  const resetAll = () => {
    resetChurn();
    setPeakConsumers({});
  };

  return (
    <C.HW_PerfPopover>
      <C.HW_DockPopoverHead>
        <Icon name="Activity" size={14} color={accentFor('primary')} />
        <C.HW_HeadTitle>Performance Churn</C.HW_HeadTitle>
        <C.HW_PillOn><C.HW_PillTextOn>{frame?.fps ? `${Math.round(frame.fps)} fps` : 'fps -'}</C.HW_PillTextOn></C.HW_PillOn>
        <C.HW_Pill><C.HW_PillText>{dominant ? `${dominant.label} ${formatMs(dominant.ms)}` : 'no frame sample'}</C.HW_PillText></C.HW_Pill>
        <C.HW_Spacer />
        <C.HW_Pill onPress={resetAll}><C.HW_PillText>reset</C.HW_PillText></C.HW_Pill>
        <C.HW_Pill onPress={onClose}><C.HW_PillText>close</C.HW_PillText></C.HW_Pill>
      </C.HW_DockPopoverHead>
      <C.HW_PerfSummarySurface staticKey="editor:perf:summary">
        <C.HW_DockPerfGrid>
          <C.HW_PerfTile>
            <C.HW_PerfValue>{frame?.frame_total_us ? formatMs(msFromUs(frame.frame_total_us)) : '-'}</C.HW_PerfValue>
            <C.HW_PerfLabel>frame total</C.HW_PerfLabel>
          </C.HW_PerfTile>
          <C.HW_PerfTile>
            <C.HW_PerfValue>{dominant ? formatMs(dominant.ms) : '-'}</C.HW_PerfValue>
            <C.HW_PerfLabel>{dominant?.label ?? 'dominant'}</C.HW_PerfLabel>
          </C.HW_PerfTile>
          <C.HW_PerfTile>
            <C.HW_PerfValue>{renderSummary ? formatCount(renderSummary.updates) : '0'}</C.HW_PerfValue>
            <C.HW_PerfLabel>React updates</C.HW_PerfLabel>
          </C.HW_PerfTile>
          <C.HW_PerfTile>
            <C.HW_PerfValue>{topRender ? formatMs(topRender.maxMs) : '0.0ms'}</C.HW_PerfValue>
            <C.HW_PerfLabel>{topRender?.id ?? 'top render'}</C.HW_PerfLabel>
          </C.HW_PerfTile>
          <C.HW_PerfTile>
            <C.HW_PerfValue>{formatCount(nodes?.visible ?? 0)}</C.HW_PerfValue>
            <C.HW_PerfLabel>visible nodes</C.HW_PerfLabel>
          </C.HW_PerfTile>
          <C.HW_PerfTile>
            <C.HW_PerfValue>{formatCount(gpu?.rect_count ?? 0)}</C.HW_PerfValue>
            <C.HW_PerfLabel>rect draws</C.HW_PerfLabel>
          </C.HW_PerfTile>
        </C.HW_DockPerfGrid>
      </C.HW_PerfSummarySurface>
      <C.HW_ChurnSummarySurface staticKey="editor:perf:summary-row">
        <C.HW_ChurnSummary>
          <Icon name={dominant?.ms && dominant.ms > 12 ? 'TriangleAlert' : 'CircleCheck'} size={13} color={accentFor(dominant?.ms && dominant.ms > 12 ? 'warning' : 'success')} />
          <C.HW_FormValue numberOfLines={1} noWrap>{causeFor(dominant)}</C.HW_FormValue>
          <C.HW_Spacer />
          <C.HW_StatusText numberOfLines={1} noWrap>flush {formatMs(msFromUs(hostFlush?.last_drain_us))} · {formatBytes(hostFlush?.last_drain_bytes)} · {formatCount(hostFlush?.queued_batches ?? 0)} queued</C.HW_StatusText>
        </C.HW_ChurnSummary>
      </C.HW_ChurnSummarySurface>
      <C.HW_TopConsumers>
        <C.HW_GroupTitle>
          <Icon name="ListOrdered" size={12} color={accentFor(ranked[0]?.hot ? 'warning' : 'primary')} />
          <C.HW_GroupText>TOP CONSUMERS</C.HW_GroupText>
          <C.HW_Spacer />
          <C.HW_StatusText>{ranked[0] ? `current + peak since reset` : 'waiting for samples'}</C.HW_StatusText>
        </C.HW_GroupTitle>
        <C.HW_TopConsumerScroll showScrollbar>
          <C.HW_TopConsumerRows>
            {ranked.map((consumer, index) => (
              <DiagnosticConsumerRow key={consumer.id} consumer={consumer} maxScore={maxConsumer} rank={index + 1} />
            ))}
          </C.HW_TopConsumerRows>
        </C.HW_TopConsumerScroll>
      </C.HW_TopConsumers>
      <C.HW_ChurnColumns>
        <C.HW_ChurnSurface staticKey="editor:perf:frame-buckets">
          <C.HW_ChurnColumn>
            <C.HW_GroupTitle>
              <Icon name="Timer" size={12} color={accentFor('primary')} />
              <C.HW_GroupText>FRAME BUCKETS</C.HW_GroupText>
            </C.HW_GroupTitle>
            {buckets.map((bucket) => <BucketRow key={bucket.id} bucket={bucket} maxMs={maxBucket} />)}
            <C.HW_GroupTitle>
              <Icon name="Cable" size={12} color={accentFor('primary')} />
              <C.HW_GroupText>SECONDARY SIGNALS</C.HW_GroupText>
            </C.HW_GroupTitle>
            {secondary.map((bucket) => <BucketRow key={bucket.id} bucket={bucket} maxMs={Math.max(1, ...secondary.map((item) => item.ms))} />)}
          </C.HW_ChurnColumn>
        </C.HW_ChurnSurface>
        <C.HW_ChurnSurface staticKey="editor:perf:react-renders">
          <C.HW_ChurnColumn>
            <C.HW_GroupTitle>
              <Icon name="RefreshCw" size={12} color={accentFor('primary')} />
              <C.HW_GroupText>REACT RENDERS</C.HW_GroupText>
              <C.HW_Spacer />
              <C.HW_StatusText>{renderSummary ? `${renderSummary.regions} probes` : 'no probes'}</C.HW_StatusText>
            </C.HW_GroupTitle>
            {(js.renders.top ?? []).slice(0, 7).map((stat) => (
              <C.HW_ChurnStatRow key={stat.id}>
                <C.HW_FormValue numberOfLines={1} noWrap>{stat.id}</C.HW_FormValue>
                <C.HW_DockValue>{formatMs(stat.totalMs)}</C.HW_DockValue>
                <C.HW_DockLabel>{stat.updates} updates</C.HW_DockLabel>
                <C.HW_DockLabel>max {formatMs(stat.maxMs)}</C.HW_DockLabel>
              </C.HW_ChurnStatRow>
            ))}
          </C.HW_ChurnColumn>
        </C.HW_ChurnSurface>
        <C.HW_ChurnSurface staticKey="editor:perf:effect-churn">
          <C.HW_ChurnColumn>
            <C.HW_GroupTitle>
              <Icon name="Unplug" size={12} color={accentFor('primary')} />
              <C.HW_GroupText>EFFECT CHURN</C.HW_GroupText>
            </C.HW_GroupTitle>
            {(js.effects.length ? js.effects : js.effectsByRuns).slice(0, 7).map((stat) => (
              <C.HW_ChurnStatRow key={`${stat.owner}:${stat.hookKind}`}>
                <C.HW_FormValue numberOfLines={1} noWrap>{stat.owner}</C.HW_FormValue>
                <C.HW_DockValue>{formatMs(stat.totalMs ?? 0)}</C.HW_DockValue>
                <C.HW_DockLabel>{stat.runCount} runs</C.HW_DockLabel>
                <C.HW_DockLabel numberOfLines={1} noWrap>{flipSummary(stat)}</C.HW_DockLabel>
              </C.HW_ChurnStatRow>
            ))}
            <C.HW_GroupTitle>
              <Icon name="Boxes" size={12} color={accentFor('primary')} />
              <C.HW_GroupText>NODE / GPU PRESSURE</C.HW_GroupText>
            </C.HW_GroupTitle>
            <C.HW_ChurnFactGrid>
              <C.HW_ChurnFact><C.HW_DockLabel>text</C.HW_DockLabel><C.HW_DockValue>{formatCount(nodes?.text ?? 0)}</C.HW_DockValue></C.HW_ChurnFact>
              <C.HW_ChurnFact><C.HW_DockLabel>images</C.HW_DockLabel><C.HW_DockValue>{formatCount(nodes?.image ?? 0)}</C.HW_DockValue></C.HW_ChurnFact>
              <C.HW_ChurnFact><C.HW_DockLabel>press</C.HW_DockLabel><C.HW_DockValue>{formatCount(nodes?.pressable ?? 0)}</C.HW_DockValue></C.HW_ChurnFact>
              <C.HW_ChurnFact><C.HW_DockLabel>glyph miss</C.HW_DockLabel><C.HW_DockValue>{formatCount(gpu?.atlas_miss_count ?? 0)}</C.HW_DockValue></C.HW_ChurnFact>
              <C.HW_ChurnFact><C.HW_DockLabel>static cap</C.HW_DockLabel><C.HW_DockValue>{formatCount(gpu?.static_capture_count ?? 0)}</C.HW_DockValue></C.HW_ChurnFact>
              <C.HW_ChurnFact><C.HW_DockLabel>3d draw</C.HW_DockLabel><C.HW_DockValue>{formatMs(msFromUs(gpu?.scene3d_draw_us))}</C.HW_DockValue></C.HW_ChurnFact>
            </C.HW_ChurnFactGrid>
          </C.HW_ChurnColumn>
        </C.HW_ChurnSurface>
      </C.HW_ChurnColumns>
      {!topEffect && !topRender ? (
        <C.HW_ChurnEmpty>
          <Icon name="Info" size={14} color={accentFor('textFaint')} />
          <C.HW_StatusText>waiting for render/effect samples</C.HW_StatusText>
        </C.HW_ChurnEmpty>
      ) : null}
    </C.HW_PerfPopover>
  );
}
