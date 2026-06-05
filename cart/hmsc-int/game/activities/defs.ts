// game/activities/defs — the repeatable-loop DEFINITION format and the
// activity tables. LOOP DEFINITIONS / CADENCES / REWARDS ARE DATA (P2): a
// definition is stages + an advance rule per stage + a reward row; every
// number lives in these tables. Durations are measured in STATE TICKS — the
// V8-ruled ~45/min reconciliation cadence (GAME_LOOP.STATE_TICKS_PER_MINUTE),
// consumed, never redesigned.
//
// The reward row carries scape design.ts's Quest.reward shape verbatim
// ({cash, itemKey, repDelta}); the dealing table carries scape's designed
// loop ("order → cook(QTE) → deliver(risk) → cash"; ROADMAP Phase 7:
// "accept → cook → deliver → paid, and a sloppy hand-off raises heat").
// scape never implemented a consumer (the oracle's contract-first hazard) —
// the engine in ./run.ts is built exactly to the ruling and these designs.

import { isActivityVerb, type ActivityVerb } from './verbs';

/** scape design.ts Quest.reward, carried verbatim. */
export type ActivityReward = {
  cash?: number;
  itemKey?: string;
  repDelta?: number;
};

/**
 * How a stage completes. Exactly one of three shapes:
 *  - ticks:        completes after N state ticks (a timed stage — cooking).
 *  - signal:       completes when the caller reports the named signal, however
 *                  long that takes (no deadline).
 *  - signalWithin: the signal must arrive within N state ticks or the run
 *                  FAILS at this stage (the risk window — a delivery, a
 *                  checkpoint against the clock).
 */
export type StageAdvance =
  | { kind: 'ticks'; ticks: number }
  | { kind: 'signal'; signal: string }
  | { kind: 'signalWithin'; signal: string; ticks: number };

export type ActivityStage = {
  id: string;
  /** one line of player-facing meaning — what this stage IS */
  brief: string;
  advance: StageAdvance;
};

/**
 * Per-definition quality policy (scape: "fussy buyers pay more, demand
 * better"; "a sloppy hand-off raises heat"). Signals may carry a quality in
 * [0,1]; the run keeps the MINIMUM reported quality. Payout scales linearly
 * from payoutFloor×cash (quality 0) to cash (quality 1); a run finishing
 * below sloppyBelow additionally raises heat by sloppyHeatDelta — payment
 * still lands (V22: failure degrades, never ends).
 */
export type QualityPolicy = {
  payoutFloor: number;
  sloppyBelow: number;
  sloppyHeatDelta: number;
};

export type ActivityDefinition = {
  key: string;
  title: string;
  /** which V22 mode preset this loop plays under */
  verb: ActivityVerb;
  stages: readonly ActivityStage[];
  reward: ActivityReward;
  /** auto: completion rolls straight into the next repetition; manual: the
   *  run parks at 'completed' until restartRun. Repeatability is the point —
   *  an activity is a side LOOP, never a one-shot. */
  repeat: 'auto' | 'manual';
  quality?: QualityPolicy;
};

/**
 * Validate + freeze an authored definition. Fails LOUD at table-build time
 * (the createCutscene discipline) — a malformed table is an authoring bug,
 * never a mid-run surprise. Exported through the door so labs author their
 * own activities against the same boundary.
 */
export function defineActivity(def: ActivityDefinition): ActivityDefinition {
  if (!def.key || typeof def.key !== 'string') throw new Error('defineActivity: key is required');
  const where = `defineActivity("${def.key}")`;
  if (!isActivityVerb(def.verb)) throw new Error(`${where}: verb ${JSON.stringify(def.verb)} is not in the V22 verb space`);
  if (!Array.isArray(def.stages) || def.stages.length < 1) throw new Error(`${where}: at least one stage is required`);
  const seen = new Set<string>();
  for (const stage of def.stages) {
    if (!stage.id) throw new Error(`${where}: every stage needs an id`);
    if (seen.has(stage.id)) throw new Error(`${where}: duplicate stage id "${stage.id}"`);
    seen.add(stage.id);
    const advance = stage.advance;
    if (advance.kind === 'ticks' || advance.kind === 'signalWithin') {
      if (!Number.isInteger(advance.ticks) || advance.ticks <= 0) {
        throw new Error(`${where}: stage "${stage.id}" needs a positive integer tick count`);
      }
    }
    if ((advance.kind === 'signal' || advance.kind === 'signalWithin') && !advance.signal) {
      throw new Error(`${where}: stage "${stage.id}" names no signal`);
    }
  }
  if (def.repeat !== 'auto' && def.repeat !== 'manual') throw new Error(`${where}: repeat must be 'auto' or 'manual'`);
  const { cash, repDelta } = def.reward;
  if (cash != null && !(cash >= 0)) throw new Error(`${where}: reward.cash must be ≥ 0`);
  if (repDelta != null && !Number.isFinite(repDelta)) throw new Error(`${where}: reward.repDelta must be finite`);
  if (def.quality) {
    const { payoutFloor, sloppyBelow, sloppyHeatDelta } = def.quality;
    if (!(payoutFloor >= 0 && payoutFloor <= 1)) throw new Error(`${where}: quality.payoutFloor must be in [0,1]`);
    if (!(sloppyBelow >= 0 && sloppyBelow <= 1)) throw new Error(`${where}: quality.sloppyBelow must be in [0,1]`);
    if (!(sloppyHeatDelta >= 0)) throw new Error(`${where}: quality.sloppyHeatDelta must be ≥ 0`);
    Object.freeze(def.quality);
  }
  for (const stage of def.stages) { Object.freeze(stage.advance); Object.freeze(stage); }
  Object.freeze(def.stages);
  Object.freeze(def.reward);
  return Object.freeze(def);
}

// ── the tables ────────────────────────────────────────────────────────────────

/**
 * The dealing loop — scape design.ts's "hands-on 'earn'", the one side loop
 * the corpus DESIGNED (never implemented). accept → cook → deliver → paid.
 * startRun IS the accept; the cook is timed (the QTE's outcome arrives as the
 * delivered signal's quality); the delivery is the risk window.
 */
const DEALING = defineActivity({
  key: 'dealing',
  title: 'Dealing',
  verb: 'accumulate',
  stages: [
    { id: 'cook', brief: 'Cook the order at a lab', advance: { kind: 'ticks', ticks: 3 } },
    { id: 'deliver', brief: 'Hand off to the buyer before they walk', advance: { kind: 'signalWithin', signal: 'delivered', ticks: 12 } },
  ],
  reward: { cash: 180 },
  repeat: 'auto',
  quality: { payoutFloor: 0.4, sloppyBelow: 0.35, sloppyHeatDelta: 12 },
});

/**
 * The race loop — ruling-derived (V22 names 'race' in the A/B-tested verb
 * space; SAMP's race mode is checkpoints against the clock). No corpus
 * reference implements it; the table exists to prove the format is
 * table-general, not dealing-shaped. Numbers are P2 starting points.
 */
const STREET_RACE = defineActivity({
  key: 'street-race',
  title: 'Street race',
  verb: 'race',
  stages: [
    { id: 'checkpoint-1', brief: 'Checkpoint 1', advance: { kind: 'signalWithin', signal: 'checkpoint', ticks: 4 } },
    { id: 'checkpoint-2', brief: 'Checkpoint 2', advance: { kind: 'signalWithin', signal: 'checkpoint', ticks: 4 } },
    { id: 'checkpoint-3', brief: 'Checkpoint 3', advance: { kind: 'signalWithin', signal: 'checkpoint', ticks: 4 } },
    { id: 'finish', brief: 'Finish line', advance: { kind: 'signalWithin', signal: 'finish', ticks: 6 } },
  ],
  reward: { cash: 250, repDelta: 2 },
  repeat: 'manual',
});

/** Every shipped activity table, by key. */
export const ACTIVITY_DEFINITIONS: Record<string, ActivityDefinition> = Object.freeze({
  [DEALING.key]: DEALING,
  [STREET_RACE.key]: STREET_RACE,
});

export function getActivityDefinition(key: string): ActivityDefinition {
  const def = ACTIVITY_DEFINITIONS[key];
  if (!def) throw new Error(`unknown activity "${key}" — shipped tables: ${Object.keys(ACTIVITY_DEFINITIONS).join(', ')}`);
  return def;
}
