// editor/data/telemetry.ts — authoring-cost telemetry over REAL measured edit
// history. No fabricated timings: editMs is the actual Date.now()-measured apply
// time of each edit (stamped in AppFrame). Empty history → avg/p95/delta all 0.
import type { HistoryEvent } from './types';

export function editSamples(history: HistoryEvent[]): Array<HistoryEvent & { editMs: number; emptyMs: number; richMs: number }> {
  return history.filter((event): event is HistoryEvent & { editMs: number; emptyMs: number; richMs: number } =>
    typeof event.editMs === 'number' && typeof event.emptyMs === 'number' && typeof event.richMs === 'number',
  );
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

export function editTelemetry(history: HistoryEvent[]) {
  const samples = editSamples(history);
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

export function formatMs(value: number): string {
  return `${value.toFixed(1)}ms`;
}
