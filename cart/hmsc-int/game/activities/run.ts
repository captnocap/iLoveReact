// game/activities/run — the loop ENGINE: a pure, deterministic state machine
// over (run, definition, signals). One call = ONE state tick (the V8-ruled
// ~45/min reconciliation cadence). Player actions force immediate ticks
// (V8's expected mutation points) — a forced tick is the SAME function called
// now with the action's signals; the engine never owns a timer, so cadence
// stays the caller's (the loop integration consumes GAME_LOOP).
//
// Determinism is R6's gameplay-wide value: no randomness, no clock reads —
// the same definition fed the same signal sequence yields byte-identical
// runs and events. Events are INERT-BY-EXPLICIT-DESIGN (the perception
// capture's precedent): every transition returns an ActivityEvent; nothing
// dispatches until the loop/story integrations land. heatRaised is the V12
// consequence hook surfaced, not built. The event vocabulary doubles as the
// V20 activities stream's event shape (./stream.ts).

import type { ActivityDefinition, ActivityReward, ActivityStage } from './defs';

export type ActivityStatus = 'active' | 'completed' | 'failed';

export type ActivityRun = {
  defKey: string;
  status: ActivityStatus;
  /** index into definition.stages while active */
  stageIndex: number;
  /** state ticks spent in the current stage */
  ticksInStage: number;
  /** MIN of every reported signal quality this repetition; 1 when none reported */
  quality: number;
  /** completed repetitions across the run's whole life */
  completions: number;
  /** cash actually paid across the run's whole life (post quality scaling) */
  totalCashPaid: number;
};

/** A player-action report. quality ∈ [0,1] when the act has a grade. */
export type ActivitySignal = { signal: string; quality?: number };

export type ActivityEvent =
  | { kind: 'started'; defKey: string }
  | { kind: 'stageAdvanced'; defKey: string; fromStageId: string; toStageId: string }
  | { kind: 'completed'; defKey: string; completions: number }
  | { kind: 'paidOut'; defKey: string; cashPaid: number; itemKey?: string; repDelta?: number }
  | { kind: 'heatRaised'; defKey: string; amount: number }
  | { kind: 'failed'; defKey: string; stageId: string; reason: 'deadline' }
  | { kind: 'repeated'; defKey: string };

export type ActivityStepResult = { run: ActivityRun; events: ActivityEvent[] };

function stageAt(def: ActivityDefinition, index: number): ActivityStage {
  return def.stages[index];
}

/** Cash actually paid for a finished repetition, per the table's quality policy. */
export function payoutCash(def: ActivityDefinition, quality: number): number {
  const cash = def.reward.cash ?? 0;
  if (!def.quality) return cash;
  const scale = def.quality.payoutFloor + (1 - def.quality.payoutFloor) * quality;
  return Math.round(cash * scale);
}

/** Begin a run — the accept. Pure: a fresh run + its started event. */
export function startRun(def: ActivityDefinition): ActivityStepResult {
  const run: ActivityRun = {
    defKey: def.key,
    status: 'active',
    stageIndex: 0,
    ticksInStage: 0,
    quality: 1,
    completions: 0,
    totalCashPaid: 0,
  };
  return { run, events: [{ kind: 'started', defKey: def.key }] };
}

/**
 * Park-to-go-again: revive a completed (manual-repeat) or failed run at stage
 * zero. Failure degrades, never ends (V22) — a failed loop is always
 * re-runnable; life totals (completions, totalCashPaid) carry over.
 */
export function restartRun(run: ActivityRun, def: ActivityDefinition): ActivityStepResult {
  if (run.defKey !== def.key) throw new Error(`restartRun: run is "${run.defKey}", definition is "${def.key}"`);
  if (run.status === 'active') return { run, events: [] };
  const next: ActivityRun = { ...run, status: 'active', stageIndex: 0, ticksInStage: 0, quality: 1 };
  return { run: next, events: [{ kind: 'repeated', defKey: def.key }] };
}

/** A finished repetition: payout per table, sloppy-heat hook, repeat policy. */
function completeRepetition(run: ActivityRun, def: ActivityDefinition, events: ActivityEvent[]): ActivityRun {
  const completions = run.completions + 1;
  events.push({ kind: 'completed', defKey: def.key, completions });
  const cashPaid = payoutCash(def, run.quality);
  events.push({
    kind: 'paidOut',
    defKey: def.key,
    cashPaid,
    ...(def.reward.itemKey != null ? { itemKey: def.reward.itemKey } : {}),
    ...(def.reward.repDelta != null ? { repDelta: def.reward.repDelta } : {}),
  });
  if (def.quality && run.quality < def.quality.sloppyBelow) {
    events.push({ kind: 'heatRaised', defKey: def.key, amount: def.quality.sloppyHeatDelta });
  }
  if (def.repeat === 'auto') {
    events.push({ kind: 'repeated', defKey: def.key });
    return { ...run, status: 'active', stageIndex: 0, ticksInStage: 0, quality: 1, completions, totalCashPaid: run.totalCashPaid + cashPaid };
  }
  return { ...run, status: 'completed', completions, totalCashPaid: run.totalCashPaid + cashPaid };
}

function advanceStage(run: ActivityRun, def: ActivityDefinition, events: ActivityEvent[]): ActivityRun {
  const from = stageAt(def, run.stageIndex);
  const nextIndex = run.stageIndex + 1;
  if (nextIndex >= def.stages.length) return completeRepetition(run, def, events);
  events.push({ kind: 'stageAdvanced', defKey: def.key, fromStageId: from.id, toStageId: stageAt(def, nextIndex).id });
  return { ...run, stageIndex: nextIndex, ticksInStage: 0 };
}

/**
 * ONE state tick. Order is fixed (determinism is the contract):
 *   1. signals apply, in the order reported — each may complete the current
 *      stage (recording its quality as the repetition's running minimum);
 *      cascades are allowed (checkpoint + finish in the same tick).
 *   2. the tick counts: timed stages complete at their tick count, deadline
 *      stages FAIL at theirs.
 * A non-active run returns the SAME reference with no events (the
 * idle-epsilon idiom — a parked activity never re-renders anything); an
 * active run always changes (its tick counted).
 */
export function stepRun(run: ActivityRun, def: ActivityDefinition, signals: readonly ActivitySignal[] = []): ActivityStepResult {
  if (run.defKey !== def.key) throw new Error(`stepRun: run is "${run.defKey}", definition is "${def.key}"`);
  if (run.status !== 'active') return { run, events: [] };

  const events: ActivityEvent[] = [];
  let current = run;

  for (const report of signals) {
    if (current.status !== 'active') break;
    const advance = stageAt(def, current.stageIndex).advance;
    if (advance.kind === 'ticks' || advance.signal !== report.signal) continue;
    if (report.quality != null) {
      if (!(report.quality >= 0 && report.quality <= 1)) {
        throw new Error(`stepRun("${def.key}"): signal "${report.signal}" quality must be in [0,1]`);
      }
      current = { ...current, quality: Math.min(current.quality, report.quality) };
    }
    current = advanceStage(current, def, events);
  }

  if (current.status === 'active') {
    const stage = stageAt(def, current.stageIndex);
    const ticksInStage = current.ticksInStage + 1;
    current = { ...current, ticksInStage };
    if (stage.advance.kind === 'ticks' && ticksInStage >= stage.advance.ticks) {
      current = advanceStage(current, def, events);
    } else if (stage.advance.kind === 'signalWithin' && ticksInStage >= stage.advance.ticks) {
      events.push({ kind: 'failed', defKey: def.key, stageId: stage.id, reason: 'deadline' });
      current = { ...current, status: 'failed' };
    }
  }

  return { run: current, events };
}
