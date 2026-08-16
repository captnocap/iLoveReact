// SECTION H — Status Bar (see shell/regions.ts SECTIONS): the bottom build
// dock — undo/redo, build journal, eventbus, perf, memory, status line, coords.
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../../runtime/icons/Icon';
import { useTelemetry } from '../../../runtime/hooks/useTelemetry';
import { head, onEvent, since, type EditorEvent } from '../../../runtime/editorbus';
import { C, accentFor } from '../workspace.cls';
import { editTelemetry, editTelemetryFromEvents, formatMs } from '../data/telemetry';
import { formatBytes, formatCount, formatMeters, selectedPieceReadout } from '../data/readouts';
import { useWorldHoverReadout } from '../data/worldHoverReadout';
import { PIECE_MODULE_METERS } from '../world/pieces';
import type { BuildJournalSnapshot, EditorState } from '../data/types';
import type { UndoDepths } from '../data/commands';
import { mapHistory } from '../../../runtime/game/map';
import type { RecoveryServerStatusV1 } from '../../../runtime/vcs/lore';

const BUS_METRIC_TAIL = 256;

/** Narrow shell projection: callers map their persisted queue truth into this shape. */
export type BuildDockAnimationQueueProjection = Readonly<{
  runState: 'stopped' | 'running' | 'paused';
  current: Readonly<{ jobId: string; seed: number }> | null;
  generated: number;
  rejected: number;
  pending: number;
  pressureSuspended: boolean;
}>;

export type AnimationQueueChipModel = Readonly<{
  stateLabel: string;
  currentLabel: string;
  countsLabel: string;
  pressureLabel: string;
  tooltip: string;
}>;

export function animationQueueChipModel(queue: BuildDockAnimationQueueProjection): AnimationQueueChipModel {
  const stateLabel = queue.runState.toUpperCase();
  const currentLabel = queue.current ? `${queue.current.jobId}:${queue.current.seed}` : '—';
  const countsLabel = `G ${queue.generated} · R ${queue.rejected} · P ${queue.pending}`;
  const pressureLabel = queue.pressureSuspended ? 'YIELD' : 'LOAD OK';
  return {
    stateLabel,
    currentLabel,
    countsLabel,
    pressureLabel,
    tooltip: `Animation queue ${queue.runState} · current ${currentLabel} · generated ${queue.generated} · rejected ${queue.rejected} · pending ${queue.pending} · ${queue.pressureSuspended ? 'yielding for editor pressure' : 'editor pressure clear'}`,
  };
}

/** Pure change gate used by the effect below; it never owns or polls telemetry. */
export function publishChangedFpsSample(
  previous: number | undefined,
  next: number,
  listener?: (fps: number) => void,
): number {
  if (previous !== next) listener?.(next);
  return next;
}

function readBusTail(): { count: number; events: EditorEvent[] } {
  const count = head();
  return { count, events: count > 0 ? since(Math.max(0, count - BUS_METRIC_TAIL)) : [] };
}

export default function BuildDock({
  state,
  journal,
  liveUndoDepths,
  onBuild,
  onEventbus,
  onUndo,
  onRedo,
  onPerf,
  onMemory,
  nativeUpdateReady,
  nativeUpdateOpen,
  onNativeUpdate,
  loreStatus,
  onLore,
  onFpsSample,
  animationQueue,
  corpusRec,
  onCorpusToggle,
}: {
  state: EditorState;
  journal: BuildJournalSnapshot;
  liveUndoDepths: UndoDepths;
  onBuild: () => void;
  onEventbus: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onPerf: () => void;
  onMemory: () => void;
  nativeUpdateReady: boolean;
  nativeUpdateOpen: boolean;
  onNativeUpdate: () => void;
  loreStatus: RecoveryServerStatusV1;
  onLore: () => void;
  onFpsSample?: (fps: number) => void;
  animationQueue?: BuildDockAnimationQueueProjection;
  corpusRec?: string | null;
  onCorpusToggle?: () => void;
}) {
  const [bus, setBus] = useState(readBusTail);
  useEffect(() => onEvent(() => setBus(readBusTail())), []);
  const telemetry = bus.events.length ? editTelemetryFromEvents(bus.events) : editTelemetry(state.history);
  const busCount = bus.count || state.history.length;
  // Undo/redo TRUTH (req_2620 gap W): on a model doc the HOST mesh journal's depths
  // (__mesh_history — polled at 2Hz, because host-native gizmo drags journal without any
  // React render, so a state mirror would lie); on the world the real worldUndo/worldRedo
  // stacks. The buttons render faint at zero and the count is always the live journal —
  // never the old history-FEED length, which reverted nothing.
  const activeDocumentKind = state.workspaceDocuments.find((d) => d.id === state.activeWorkspaceDocumentId)?.kind ?? 'world';
  const isModelDoc = activeDocumentKind === 'model';
  const isKnowledgeDoc = activeDocumentKind === 'knowledge';
  // While the paint session is live the STROKE journal is the badge's truth (req_2672)
  // — same 2Hz poll, different door: strokes land host-side per gesture with no render.
  const painting = isModelDoc && state.modelTool.paint;
  const rigHistory = isModelDoc && liveUndoDepths.source === 'rig';
  const mapPainting = activeDocumentKind === 'world' && state.mapPaint.active;
  const [meshDepths, setMeshDepths] = useState({ undo: 0, redo: 0 });
  const [mapDepths, setMapDepths] = useState({ undo: 0, redo: 0 });
  useEffect(() => {
    if (!isModelDoc || rigHistory) return;
    const read = () => {
      try {
        const j = painting ? (globalThis as any).__mesh_paint_history?.() : (globalThis as any).__mesh_history?.();
        if (typeof j === 'string' && j) {
          const o = JSON.parse(j);
          const next = { undo: (o.undo ?? 0) | 0, redo: (o.redo ?? 0) | 0 };
          setMeshDepths((prev) => (prev.undo === next.undo && prev.redo === next.redo ? prev : next));
        }
      } catch { /* door missing → honest zeros */ }
    };
    read();
    const t = setInterval(read, 500);
    return () => clearInterval(t);
  }, [isModelDoc, painting, rigHistory]);
  useEffect(() => {
    if (!mapPainting) return;
    const read = () => {
      const history = mapHistory();
      const next = { undo: history.undo, redo: history.redo };
      setMapDepths((prev) => (prev.undo === next.undo && prev.redo === next.redo ? prev : next));
    };
    read();
    const t = setInterval(read, 500);
    return () => clearInterval(t);
  }, [mapPainting]);
  const undoCount = isKnowledgeDoc ? 0 : isModelDoc ? (rigHistory ? liveUndoDepths.undo : meshDepths.undo) : mapPainting ? mapDepths.undo : state.worldUndo.length;
  const redoCount = isKnowledgeDoc ? 0 : isModelDoc ? (rigHistory ? liveUndoDepths.redo : meshDepths.redo) : mapPainting ? mapDepths.redo : state.worldRedo.length;
  // Cursor hover wins while the mouse is over the world; selection is the fallback.
  const hover = useWorldHoverReadout();
  const piece = isKnowledgeDoc ? null : hover ?? selectedPieceReadout(state);
  // Real host telemetry — polled at 2Hz (cheap; never per-frame). Empty sources
  // render as 0/— instead of seeded historical data.
  const { value: fps } = useTelemetry({ kind: 'fps', pollMs: 500 });
  const publishedFps = useRef<number | undefined>(undefined);
  useEffect(() => {
    publishedFps.current = publishChangedFpsSample(publishedFps.current, fps, onFpsSample);
  }, [fps, onFpsSample]);
  const { data: frame } = useTelemetry<{ frame_total_us?: number; gpu_us?: number }>({ kind: 'frame', pollMs: 500 });
  const { data: gpu } = useTelemetry<{ scene3d_triangles?: number; scene3d_draw_calls?: number }>({ kind: 'gpu', pollMs: 500 });
  const { data: system } = useTelemetry<{ process_rss_bytes?: number; mem_total_bytes?: number }>({ kind: 'system', pollMs: 1000 });
  const loreTone = loreStatus.state === 'ready' ? 'success'
    : loreStatus.state === 'checking' ? 'textFaint'
      : 'warning';
  const loreBadge = (
    <C.HW_DockBuild
      onPress={onLore}
      tooltip={loreStatus.state === 'blocked'
        ? `Lore recovery is blocked · ${loreStatus.retention.lastError ?? 'open Service for details'}`
        : loreStatus.state === 'local'
          ? 'Lore server is unavailable; native-resident recovery remains local'
          : 'Open Blob Explorer recovery service'}
    >
      <Icon name={loreStatus.state === 'ready' ? 'DatabaseBackup' : 'TriangleAlert'} size={12} color={accentFor(loreTone)} />
      <C.HW_DockLabel>LORE</C.HW_DockLabel>
      <C.HW_DockValue>{loreStatus.state.toUpperCase()}</C.HW_DockValue>
    </C.HW_DockBuild>
  );
  // Retopo-corpus recording light (req_4604): forgetting to arm the recorder is
  // the failure mode this exists for, so ON must be loud — warning-orange dot +
  // the entry name, always in the dock. Click toggles begin/finish.
  const corpusChip = onCorpusToggle ? (
    <C.HW_DockBuild
      onPress={onCorpusToggle}
      tooltip={corpusRec
        ? `Recording retopo corpus entry "${corpusRec}" — save the model, then click to stop and bundle`
        : 'Start retopo-corpus recording for the active model (edit trail + journal + final package)'}
    >
      <Icon name={corpusRec ? 'CircleDot' : 'Circle'} size={12} color={accentFor(corpusRec ? 'warning' : 'textFaint')} />
      <C.HW_DockLabel>REC</C.HW_DockLabel>
      <C.HW_DockValue>{corpusRec ?? 'OFF'}</C.HW_DockValue>
    </C.HW_DockBuild>
  ) : null;
  const frameMs = frame?.frame_total_us ? frame.frame_total_us / 1000 : 0;
  const gpuMs = frame?.gpu_us ? frame.gpu_us / 1000 : 0;
  const triCount = gpu?.scene3d_triangles ?? 0;
  const drawCalls = gpu?.scene3d_draw_calls ?? 0;
  const queueModel = animationQueue ? animationQueueChipModel(animationQueue) : null;
  const queueChip = queueModel && animationQueue ? (
    <C.HW_DockGroup tooltip={queueModel.tooltip}>
      <Icon name="Activity" size={12} color={accentFor(animationQueue.pressureSuspended ? 'warning' : animationQueue.runState === 'running' ? 'success' : 'textFaint')} />
      <C.HW_DockLabel>QUEUE</C.HW_DockLabel>
      <C.HW_DockValue>{queueModel.stateLabel}</C.HW_DockValue>
      <C.HW_DockCoord>{queueModel.currentLabel}</C.HW_DockCoord>
      <C.HW_DockLabel>{queueModel.countsLabel}</C.HW_DockLabel>
      <C.HW_DockValue>{queueModel.pressureLabel}</C.HW_DockValue>
    </C.HW_DockGroup>
  ) : null;
  if (isKnowledgeDoc) {
    return (
      <C.HW_BuildDock>
        <C.HW_Spacer />
        {queueChip}
        <C.HW_DockPerfButton onPress={onPerf}>
          <C.HW_DockLabel>FPS:</C.HW_DockLabel>
          <C.HW_DockCoord>{fps > 0 ? Math.round(fps) : '-'}</C.HW_DockCoord>
          <C.HW_DockLabel>FRAME</C.HW_DockLabel>
          <C.HW_DockValue>{frameMs > 0 ? formatMs(frameMs) : '-'}</C.HW_DockValue>
        </C.HW_DockPerfButton>
        <C.HW_DockPerfButton onPress={onMemory}>
          <Icon name="Activity" size={13} color={accentFor(state.memoryPopoverOpen ? 'primary' : 'textFaint')} />
          <C.HW_DockLabel>MEM</C.HW_DockLabel>
          <C.HW_DockLabel>{formatBytes(system?.process_rss_bytes)}/{formatBytes(system?.mem_total_bytes)}</C.HW_DockLabel>
        </C.HW_DockPerfButton>
        {nativeUpdateReady ? (
          <C.HW_DockBuild onPress={onNativeUpdate} tooltip="Compiled native update waiting for your approval">
            <Icon name="TriangleAlert" size={13} color={accentFor(nativeUpdateOpen ? 'primary' : 'warning')} />
            <C.HW_DockLabel>NATIVE</C.HW_DockLabel>
            <C.HW_DockValue>READY</C.HW_DockValue>
          </C.HW_DockBuild>
        ) : null}
        {corpusChip}
        {loreBadge}
      </C.HW_BuildDock>
    );
  }
  return (
    <C.HW_BuildDock>
      <C.HW_DockBuild onPress={onBuild}>
        <C.HW_DockLabel>Build:</C.HW_DockLabel>
        <C.HW_DockValue>{journal.activeBuild}</C.HW_DockValue>
        <Icon name="CircleCheck" size={15} color={accentFor('success')} />
      </C.HW_DockBuild>
      <C.HW_DockDivider />
      <C.HW_DockGroup>
        <C.HW_DockLabel>POS</C.HW_DockLabel>
        <C.HW_DockCoord>{`X ${piece ? piece.x : '—'}`}</C.HW_DockCoord>
        <C.HW_DockCoord>{`Y ${piece ? piece.y : '—'}`}</C.HW_DockCoord>
        <C.HW_DockCoord>{`Z ${piece ? piece.z : '—'}`}</C.HW_DockCoord>
      </C.HW_DockGroup>
      <C.HW_DockGroup>
        <C.HW_DockLabel>GRID</C.HW_DockLabel>
        <C.HW_DockValue>{formatMeters(PIECE_MODULE_METERS)}</C.HW_DockValue>
        <C.HW_DockLabel>ANG</C.HW_DockLabel>
        <C.HW_DockValue>{!hover && piece && 'yawDegrees' in piece ? `${piece.yawDegrees}deg` : '—'}</C.HW_DockValue>
      </C.HW_DockGroup>
      <C.HW_DockDivider />
      <C.HW_DockBuild onPress={onEventbus}>
        <Icon name="Workflow" size={12} color={accentFor(state.eventbusPopoverOpen ? 'primary' : 'textSecondary')} />
        <C.HW_DockLabel>BUS</C.HW_DockLabel>
        <C.HW_DockValue>{busCount}</C.HW_DockValue>
      </C.HW_DockBuild>
      <C.HW_DockBuild onPress={onUndo} tooltip={mapPainting ? 'Undo (Map Paint native journal)' : rigHistory ? 'Undo (character rig history)' : painting ? 'Undo (paint strokes)' : isModelDoc ? 'Undo (host mesh journal)' : 'Undo (world edits)'}>
        <Icon name="Undo2" size={12} color={accentFor(undoCount > 0 ? 'textSecondary' : 'textFaint')} />
        <C.HW_DockLabel>UNDO</C.HW_DockLabel>
        <C.HW_DockValue>{undoCount}</C.HW_DockValue>
      </C.HW_DockBuild>
      <C.HW_DockBuild onPress={onRedo} tooltip={mapPainting ? 'Redo (Map Paint native journal)' : rigHistory ? 'Redo (character rig history)' : painting ? 'Redo (paint strokes)' : isModelDoc ? 'Redo (host mesh journal)' : 'Redo (world edits)'}>
        <Icon name="Redo2" size={12} color={accentFor(redoCount > 0 ? 'textSecondary' : 'textFaint')} />
        <C.HW_DockLabel>REDO</C.HW_DockLabel>
        <C.HW_DockValue>{redoCount}</C.HW_DockValue>
      </C.HW_DockBuild>
      <C.HW_DockGroup>
        <C.HW_DockLabel>AVG</C.HW_DockLabel>
        <C.HW_DockValue>{formatMs(telemetry.avg)}</C.HW_DockValue>
        <C.HW_DockLabel>P95</C.HW_DockLabel>
        <C.HW_DockValue>{formatMs(telemetry.p95)}</C.HW_DockValue>
        <C.HW_DockLabel>DELTA</C.HW_DockLabel>
        <C.HW_DockCoord>+{formatMs(telemetry.delta)}</C.HW_DockCoord>
      </C.HW_DockGroup>
      <C.HW_DockGroup>
        <Icon name={telemetry.parity === 'stable' ? 'CircleCheck' : 'TriangleAlert'} size={12} color={accentFor(telemetry.parity === 'stable' ? 'success' : 'warning')} />
        <C.HW_DockLabel>PARITY</C.HW_DockLabel>
        <C.HW_DockValue>{telemetry.parity}</C.HW_DockValue>
      </C.HW_DockGroup>
      <C.HW_Spacer />
      {queueChip}
      <C.HW_DockDivider />
      <C.HW_DockPerfButton onPress={onPerf}>
        <C.HW_DockLabel>FPS:</C.HW_DockLabel>
        <C.HW_DockCoord>{fps > 0 ? Math.round(fps) : '-'}</C.HW_DockCoord>
        <C.HW_DockLabel>FRAME</C.HW_DockLabel>
        <C.HW_DockValue>{frameMs > 0 ? formatMs(frameMs) : '-'}</C.HW_DockValue>
        <C.HW_DockLabel>GPU</C.HW_DockLabel>
        <C.HW_DockValue>{gpuMs > 0 ? formatMs(gpuMs) : '-'}</C.HW_DockValue>
        <C.HW_DockLabel>TRI</C.HW_DockLabel>
        <C.HW_DockValue>{formatCount(triCount)}</C.HW_DockValue>
        <C.HW_DockLabel>DC</C.HW_DockLabel>
        <C.HW_DockValue>{formatCount(drawCalls)}</C.HW_DockValue>
      </C.HW_DockPerfButton>
      <C.HW_DockPerfButton onPress={onMemory}>
        <Icon name="Activity" size={13} color={accentFor(state.memoryPopoverOpen ? 'primary' : 'textFaint')} />
        <C.HW_DockLabel>MEM</C.HW_DockLabel>
        <C.HW_DockLabel>{formatBytes(system?.process_rss_bytes)}/{formatBytes(system?.mem_total_bytes)}</C.HW_DockLabel>
      </C.HW_DockPerfButton>
      {nativeUpdateReady ? (
        <C.HW_DockBuild onPress={onNativeUpdate} tooltip="Compiled native update waiting for your approval">
          <Icon name="TriangleAlert" size={13} color={accentFor(nativeUpdateOpen ? 'primary' : 'warning')} />
          <C.HW_DockLabel>NATIVE</C.HW_DockLabel>
          <C.HW_DockValue>READY</C.HW_DockValue>
        </C.HW_DockBuild>
      ) : null}
      {corpusChip}
      {loreBadge}
    </C.HW_BuildDock>
  );
}
