// placeFreezeProbe — the place-freeze diagnostic probe, lifted verbatim out of
// PlayRoute so the embodied F2 build mode AND the iso authoring pane share ONE
// probe (and one global sequence). Behavior is unchanged from when this lived in
// PlayRoute: a probe stamps phase timings into the 'worldStream' telemetry channel
// and warns on any phase over the 16ms frame budget. The iso pane passes a null
// probe (the prop accepts it) until it grows its own place-freeze tracing.

import { GAME_TELEMETRY } from '@game';

export function perfMs(): number {
  const host = globalThis as any;
  if (typeof host.__bench_now_us === 'function') {
    const us = Number(host.__bench_now_us());
    if (Number.isFinite(us)) return us / 1000;
  }
  const perf = (globalThis as any).performance;
  return typeof perf?.now === 'function' ? perf.now() : Date.now();
}

export function warnPlaceFreeze(label: string, fields: Record<string, unknown>): void {
  const ms = fields.ms;
  const totalMs = fields.totalMs;
  const cost = typeof totalMs === 'number' ? totalMs : typeof ms === 'number' ? ms : 0;
  if (cost < 16) return;
  const parts = Object.entries(fields).map(([key, value]) =>
    typeof value === 'number' ? `${key}=${value.toFixed(2)}` : `${key}=${String(value)}`);
  console.warn(`[PLACEFREEZE] ${label} ${parts.join(' ')}`);
}

export type PlaceFreezeProbe = {
  id: number;
  t0: number;
  label: string;
  piecesBefore: number;
};

let placeFreezeProbeSeq = 0;

function placeFreezeField(value: unknown): string {
  return typeof value === 'number' ? value.toFixed(2) : String(value);
}

export function startPlaceFreezeProbe(label: string, piecesBefore: number): PlaceFreezeProbe {
  placeFreezeProbeSeq += 1;
  const probe = { id: placeFreezeProbeSeq, t0: perfMs(), label, piecesBefore };
  console.warn(`[PLACEFREEZE:${probe.id}] accept label=${label} piecesBefore=${piecesBefore}`);
  return probe;
}

export function markPlaceFreezeProbe(probe: PlaceFreezeProbe | null | undefined, phase: string, fields: Record<string, unknown> = {}): void {
  if (!probe) return;
  const dtMs = perfMs() - probe.t0;
  const payload = { probeId: probe.id, label: probe.label, phase, dtMs, piecesBefore: probe.piecesBefore, ...fields };
  GAME_TELEMETRY.recordDiagnostic('worldStream', `placefreeze.${phase}`, payload);
  const parts = Object.entries(payload).map(([key, value]) => `${key}=${placeFreezeField(value)}`);
  console.warn(`[PLACEFREEZE:${probe.id}] ${parts.join(' ')}`);
}
