// game/activities/ — GAME_ACTIVITIES: repeatable side loops, the non-mission
// gameplay verbs. THE ONE DOOR (P3) over:
//
//   verbs.ts   the V22 verb space as data — role/rob/chase/evade/race/jump/
//              accumulate, each a DISTRIBUTION PRESET of the V21 machine
//              (named here, interpreted there — never a new system)
//   defs.ts    loop definitions / cadences / rewards as tables (P2); durations
//              in STATE TICKS — the V8-ruled ~45/min reconciliation cadence
//   run.ts     the pure deterministic engine: start → step-per-tick →
//              complete → pay what the table says → repeat (R6)
//   stream.ts  the V20 'activities' concern — log + materializer in one
//              registration, ready for any store's defineStream
//
// Missions are NOT activities (CaaS rows, a separate capture); story is not
// either. The verb presets and the heatRaised consequence hook surface seams
// for the V21 population lane and V12 perception — surfaced, not built.

import { stateTickIntervalMs } from '../loop';
import { ACTIVITY_VERBS, ACTIVITY_VERB_DEFINITIONS, isActivityVerb } from './verbs';
import { ACTIVITY_DEFINITIONS, defineActivity, getActivityDefinition, type ActivityStage } from './defs';
import { startRun, stepRun, restartRun, payoutCash } from './run';
import { activitiesStream } from './stream';

export type { ActivityVerb, ActivityVerbDefinition, DistributionPreset } from './verbs';
export type {
  ActivityDefinition, ActivityStage, ActivityReward, StageAdvance, QualityPolicy,
} from './defs';
export type {
  ActivityRun, ActivitySignal, ActivityEvent, ActivityStatus, ActivityStepResult,
} from './run';
export type { ActivitiesStreamState, ActivityTotals } from './stream';

/**
 * How long a tick-bounded stage spans in wall milliseconds — the table speaks
 * state ticks, GAME_LOOP owns the ruled cadence, this is the one conversion.
 * Stages with no tick bound (open 'signal' stages) have no duration: null.
 */
export function stageDurationMs(stage: ActivityStage): number | null {
  const advance = stage.advance;
  if (advance.kind === 'signal') return null;
  return advance.ticks * stateTickIntervalMs();
}

export const GAME_ACTIVITIES = Object.freeze({
  // the V22 verb space (data; V21 interprets the presets)
  VERBS: ACTIVITY_VERBS,
  VERB_DEFINITIONS: ACTIVITY_VERB_DEFINITIONS,
  isVerb: isActivityVerb,
  // the tables (P2) + the authoring boundary labs use
  DEFINITIONS: ACTIVITY_DEFINITIONS,
  get: getActivityDefinition,
  define: defineActivity,
  // the engine (pure; one call = one state tick)
  startRun,
  stepRun,
  restartRun,
  payoutCash,
  stageDurationMs,
  // the V20 concern (hand to store.defineStream)
  stream: activitiesStream,
});
