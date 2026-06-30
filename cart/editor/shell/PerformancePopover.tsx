import { useEffect, useState } from 'react';
import { Icon } from '../../../runtime/icons/Icon';
import { useTelemetry } from '../../../runtime/hooks/useTelemetry';
import { C, accentFor } from '../workspace.cls';
import { formatMs } from '../data/telemetry';
import { formatBytes, formatCount } from '../data/readouts';

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
  const topRender = js.renders.top?.[0];
  const topEffect = js.effects[0] ?? js.effectsByRuns[0];

  return (
    <C.HW_PerfPopover>
      <C.HW_DockPopoverHead>
        <Icon name="Activity" size={14} color={accentFor('primary')} />
        <C.HW_HeadTitle>Performance Churn</C.HW_HeadTitle>
        <C.HW_PillOn><C.HW_PillTextOn>{frame?.fps ? `${Math.round(frame.fps)} fps` : 'fps -'}</C.HW_PillTextOn></C.HW_PillOn>
        <C.HW_Pill><C.HW_PillText>{dominant ? `${dominant.label} ${formatMs(dominant.ms)}` : 'no frame sample'}</C.HW_PillText></C.HW_Pill>
        <C.HW_Spacer />
        <C.HW_Pill onPress={() => { resetChurn(); }}><C.HW_PillText>reset</C.HW_PillText></C.HW_Pill>
        <C.HW_Pill onPress={onClose}><C.HW_PillText>close</C.HW_PillText></C.HW_Pill>
      </C.HW_DockPopoverHead>
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
      <C.HW_ChurnSummary>
        <Icon name={dominant?.ms && dominant.ms > 12 ? 'TriangleAlert' : 'CircleCheck'} size={13} color={accentFor(dominant?.ms && dominant.ms > 12 ? 'warning' : 'success')} />
        <C.HW_FormValue numberOfLines={1} noWrap>{causeFor(dominant)}</C.HW_FormValue>
        <C.HW_Spacer />
        <C.HW_StatusText numberOfLines={1} noWrap>flush {formatMs(msFromUs(hostFlush?.last_drain_us))} · {formatBytes(hostFlush?.last_drain_bytes)} · {formatCount(hostFlush?.queued_batches ?? 0)} queued</C.HW_StatusText>
      </C.HW_ChurnSummary>
      <C.HW_ChurnColumns>
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
