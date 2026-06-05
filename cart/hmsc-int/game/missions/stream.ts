// game/missions/stream — the V20 per-concern stream for missions, defined in
// ONE registration (log name + materializer; a stream without snapshot
// support cannot be expressed — the data layer's incompleteness guard).
//
// The engine's MissionEvent vocabulary IS the stream's event shape. The
// materialized snapshot is V22's "completion/rating data feeds tomorrow's
// generation weights" made storable: per-VERB outcome tallies + rating sums
// (the generation weights' input — the mission generator and the fiction's
// antagonist are the same machine), cash paid, collateral total. The
// materializer tolerates unknown event kinds by contract — new mission
// features arrive as event ADDITIONS, old logs stay valid forever (V20).

import type { StreamDef } from '../../data';
import type { MissionEvent } from './run';

export type MissionVerbOutcomes = {
  completed: number;
  failed: number;
  voided: number;
  /** sum of completion ratings — ratingSum/completed is the verb's average */
  ratingSum: number;
};

export type MissionsStreamState = {
  /** per-verb outcome tallies — tomorrow's generation weights read THIS */
  perVerb: Record<string, MissionVerbOutcomes>;
  cashPaid: number;
  /** civilian kills the collateral policies recorded (rating docks) */
  collateralDocks: number;
};

function outcomesFor(state: MissionsStreamState, verb: string): MissionVerbOutcomes {
  return state.perVerb[verb] ?? { completed: 0, failed: 0, voided: 0, ratingSum: 0 };
}

function withOutcomes(state: MissionsStreamState, verb: string, outcomes: MissionVerbOutcomes): MissionsStreamState {
  return { ...state, perVerb: { ...state.perVerb, [verb]: outcomes } };
}

export const missionsStream: StreamDef<MissionsStreamState, MissionEvent> = Object.freeze({
  name: 'missions',
  initial: (): MissionsStreamState => ({ perVerb: {}, cashPaid: 0, collateralDocks: 0 }),
  apply: (state: MissionsStreamState, event: MissionEvent): MissionsStreamState => {
    switch (event?.kind) {
      case 'completed': {
        const outcomes = outcomesFor(state, event.verb);
        return withOutcomes(state, event.verb, {
          ...outcomes,
          completed: outcomes.completed + 1,
          ratingSum: outcomes.ratingSum + event.rating,
        });
      }
      case 'failed': {
        const outcomes = outcomesFor(state, event.verb);
        return withOutcomes(state, event.verb, { ...outcomes, failed: outcomes.failed + 1 });
      }
      case 'voided': {
        const outcomes = outcomesFor(state, event.verb);
        return withOutcomes(state, event.verb, { ...outcomes, voided: outcomes.voided + 1 });
      }
      case 'paidOut':
        return { ...state, cashPaid: state.cashPaid + event.cashPaid };
      case 'ratingDocked':
        return { ...state, collateralDocks: state.collateralDocks + event.amount };
      default:
        // accepted/hookFired/objectiveComplete/stageAdvanced/restarted/rearmed
        // carry no tallies — and unknown kinds from the future MUST pass
        // through untouched (V20 schema evolution by addition).
        return state;
    }
  },
});
