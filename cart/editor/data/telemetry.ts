// editor/data/telemetry.ts — authoring-cost telemetry over REAL measured edit
// history. No fabricated timings: editMs is the actual Date.now()-measured apply
// time of each edit (stamped in AppFrame). Empty history → avg/p95/delta all 0.
import type { HistoryEvent } from './types';
import type { EditorEvent } from '../../../runtime/editorbus';

export type EditTimingSample = { editMs: number; emptyMs: number; richMs: number };

export function editSamples(history: HistoryEvent[]): Array<HistoryEvent & { editMs: number; emptyMs: number; richMs: number }> {
  return history.filter((event): event is HistoryEvent & { editMs: number; emptyMs: number; richMs: number } =>
    typeof event.editMs === 'number' && typeof event.emptyMs === 'number' && typeof event.richMs === 'number',
  );
}

function finiteMs(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : null;
}

export function eventTimingSamples(events: EditorEvent[]): EditTimingSample[] {
  const samples: EditTimingSample[] = [];
  for (const event of events) {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const editMs = finiteMs(payload.inputToAppliedMs) ?? finiteMs(payload.inputToMaterializedMs) ?? finiteMs(payload.inputToCommitMs) ?? finiteMs(payload.editMs) ?? finiteMs(payload.applyMs);
    if (editMs === null) continue;
    const emptyMs = finiteMs(payload.applyMs) ?? finiteMs(payload.emptyMs) ?? editMs;
    const richMs = finiteMs(payload.inputToAppliedMs) ?? finiteMs(payload.inputToMaterializedMs) ?? finiteMs(payload.richMs) ?? editMs;
    samples.push({ editMs, emptyMs, richMs });
  }
  return samples;
}

export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))]!;
}

export function editTelemetryFromSamples(samples: EditTimingSample[]) {
  const richValues = samples.map((event) => event.richMs);
  const deltas = samples.map((event) => event.richMs - event.emptyMs);
  const delta = average(deltas);
  return {
    samples,
    avg: average(richValues),
    p95: percentile(richValues, 0.95),
    delta,
    parity: delta <= 1 ? 'stable' : 'watch',
  };
}

export function editTelemetry(history: HistoryEvent[]) {
  return editTelemetryFromSamples(editSamples(history));
}

export function editTelemetryFromEvents(events: EditorEvent[]) {
  return editTelemetryFromSamples(eventTimingSamples(events));
}

export function formatMs(value: number): string {
  return `${value.toFixed(1)}ms`;
}
