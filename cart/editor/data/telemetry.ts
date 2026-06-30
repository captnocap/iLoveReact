// editor/data/telemetry.ts — authoring-cost telemetry helpers over edit history.
//
// Cloned from the hmsc-workspace-mock god-file. Pure helpers.
// The HistoryEvent type lives in ./types (it is also referenced by MockState).
import type { HistoryEvent } from './types';

export function editTimingFor(seq: number, commandId: string): Pick<HistoryEvent, 'editMs' | 'emptyMs' | 'richMs'> {
  const baseByCommand: Record<string, number> = {
    'place-piece': 14,
    'move-selection': 8,
    'paint-material': 11,
    'duplicate-selection': 12,
    'delete-selection': 9,
    'add-trigger': 13,
    'set-spawn': 10,
    'mission-point': 12,
    'author-sequence': 15,
    'compile-rle': 21,
    favorite: 4,
  };
  const base = baseByCommand[commandId] ?? 7;
  const emptyMs = base + (seq % 4) * 0.6;
  const richMs = emptyMs + 0.2 + (seq % 3) * 0.1;
  return { editMs: richMs, emptyMs, richMs };
}

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
