// game/activities/stream — the V20 per-concern stream for activities, defined
// in ONE registration (log name + materializer; a stream without snapshot
// support cannot be expressed — the data layer's incompleteness guard).
//
// The engine's ActivityEvent vocabulary IS the stream's event shape: the loop
// integration appends what stepRun returns, and the materialized snapshot is
// what the game/compile loads (never the history). The materializer tolerates
// unknown event kinds by contract — new activity features arrive as event
// ADDITIONS, old logs stay valid forever (V20 schema-evolution-by-addition).

import type { StreamDef } from '../../data';
import type { ActivityEvent } from './run';

export type ActivityTotals = {
  completions: number;
  cashPaid: number;
  failures: number;
};

export type ActivitiesStreamState = {
  /** per-definition life totals, by activity key */
  totals: Record<string, ActivityTotals>;
  /** accumulated heat raised by sloppy activity play (V12 consumes later) */
  heatRaised: number;
};

function totalsFor(state: ActivitiesStreamState, defKey: string): ActivityTotals {
  return state.totals[defKey] ?? { completions: 0, cashPaid: 0, failures: 0 };
}

function withTotals(state: ActivitiesStreamState, defKey: string, totals: ActivityTotals): ActivitiesStreamState {
  return { ...state, totals: { ...state.totals, [defKey]: totals } };
}

export const activitiesStream: StreamDef<ActivitiesStreamState, ActivityEvent> = Object.freeze({
  name: 'activities',
  initial: (): ActivitiesStreamState => ({ totals: {}, heatRaised: 0 }),
  apply: (state: ActivitiesStreamState, event: ActivityEvent): ActivitiesStreamState => {
    switch (event?.kind) {
      case 'completed': {
        const totals = totalsFor(state, event.defKey);
        return withTotals(state, event.defKey, { ...totals, completions: event.completions });
      }
      case 'paidOut': {
        const totals = totalsFor(state, event.defKey);
        return withTotals(state, event.defKey, { ...totals, cashPaid: totals.cashPaid + event.cashPaid });
      }
      case 'failed': {
        const totals = totalsFor(state, event.defKey);
        return withTotals(state, event.defKey, { ...totals, failures: totals.failures + 1 });
      }
      case 'heatRaised':
        return { ...state, heatRaised: state.heatRaised + event.amount };
      default:
        // started/stageAdvanced/repeated carry no totals — and unknown kinds
        // from the future MUST pass through untouched (V20).
        return state;
    }
  },
});
