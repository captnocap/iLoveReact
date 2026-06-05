import type { DocIndex } from '../types';

export const game_activities: DocIndex = {
  name: 'game_activities',
  file: 'hmsc-int.md',
  cart: 'cart/hmsc-int/game/activities/index.ts',
  purpose: ['game_loop', 'scripting'],
  summary:
    'V22/V8/V20 capture of repeatable side loops — the non-mission gameplay verbs. The ruled verb space (role/rob/chase/evade/race/jump/accumulate) as DATA: each verb a distribution preset of the V21 machine (named here, interpreted there — never a new system). Loop definitions/cadences/rewards are P2 tables in STATE TICKS; a pure deterministic engine advances a run per tick, completes, repeats, and pays what its table says; the V20 activities stream folds the engine events into life totals.',
  interfaces: [
    {
      name: 'GAME_ACTIVITIES',
      purpose: ['game_loop', 'scripting'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/game/activities/index.ts',
      description:
        'The P3 door: the verb space (VERBS/VERB_DEFINITIONS), the tables (DEFINITIONS/get) + the defineActivity authoring boundary, the engine (startRun/stepRun/restartRun/payoutCash), stageDurationMs (the one tick→ms conversion, consuming GAME_LOOP), and the V20 stream def. Missions/story are separate captures; heatRaised is the V12 hook surfaced, not built.',
      dependsOn: ['GAME_LOOP'],
      status: 'live',
    },
    {
      name: 'ACTIVITY_VERB_DEFINITIONS',
      purpose: ['game_loop'],
      kind: 'data_model',
      sourceFile: 'cart/hmsc-int/game/activities/verbs.ts',
      description:
        'The V22 verb space as frozen data — role/rob/chase/evade/race/jump/accumulate, each carrying a DistributionPreset whose field vocabulary is V21’s own ruling text (cop/civilian/traffic weights, temperature bias, convergence bias, promotion budget). Preset VALUES are P2 starting points with no corpus reference; the V21 machine owns interpretation.',
      status: 'live',
    },
    {
      name: 'defineActivity',
      purpose: ['game_loop', 'format'],
      kind: 'utility',
      sourceFile: 'cart/hmsc-int/game/activities/defs.ts',
      description:
        'Validate + freeze an ActivityDefinition at table-build time (the createCutscene fail-loud discipline): stages with ticks/signal/signalWithin advance rules (durations in STATE TICKS), the scape Quest.reward row verbatim, repeat auto/manual, optional quality policy (payout floor + sloppy heat). Exported through the door so labs author their own loops against the same boundary.',
      status: 'live',
    },
    {
      name: 'stepRun',
      purpose: ['game_loop'],
      kind: 'utility',
      sourceFile: 'cart/hmsc-int/game/activities/run.ts',
      description:
        'ONE call = ONE state tick (the V8 ~45/min reconciliation cadence, consumed never redesigned; a player action’s forced tick is the same call now with its signals). Fixed order: signals apply (each may complete the current stage, recording min quality; cascades allowed), then the tick counts (timed stages complete, deadline stages FAIL). Pure + deterministic (R6); events are inert returns; a parked run comes back same-reference.',
      status: 'live',
    },
    {
      name: 'activitiesStream',
      purpose: ['persistence', 'game_loop'],
      kind: 'data_model',
      sourceFile: 'cart/hmsc-int/game/activities/stream.ts',
      description:
        'The V20 activities concern in ONE registration (log name + materializer): the engine’s ActivityEvent vocabulary is the stream’s event shape; folds per-definition life totals (completions/cashPaid/failures) + heatRaised; unknown future event kinds pass through untouched (schema evolution by addition).',
      status: 'live',
    },
    {
      name: 'ACTIVITY_DEFINITIONS',
      purpose: ['game_loop'],
      kind: 'data_model',
      sourceFile: 'cart/hmsc-int/game/activities/defs.ts',
      description:
        'The shipped tables: dealing (scape’s designed earn loop — accept(start) → cook(3 ticks) → deliver(signal within 12 ticks); quality scales payout from a 0.4 floor, sloppy below 0.35 raises heat 12 and STILL pays — failure degrades, never ends) and street-race (ruling-derived checkpoint loop proving the format is table-general). Every number is the table’s (P2).',
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'Verbs as conditioning presets, never systems',
      purpose: ['game_loop'],
      description:
        'A game mode is a DATA row naming what it dials on the V21 machine — the activities layer ships the request vocabulary and zero simulation. The seam between the mode layer and the population machine is a frozen record, so the V21 lane can land/rename freely.',
      examples: ['hmsc-int'],
      status: 'recurring',
    },
    {
      name: 'Caller-cadenced pure step (one call = one state tick)',
      purpose: ['game_loop'],
      description:
        'The engine owns no timer (R3 keeps loop shapes un-canonized): the loop integration calls stepRun once per V8 reconciliation tick, and a player action forces an immediate tick by calling it now with signals. Same shape as perceptionStep — pure in, state + inert events out.',
      examples: ['hmsc-int'],
      status: 'recurring',
    },
  ],
  hazards: [
    {
      name: 'preset values and street-race are ruling-derived, not reference behavior',
      purpose: ['game_loop'],
      description:
        'No corpus reference implements verb conditioning or a race loop — the DistributionPreset numbers are invented P2 starting points and street-race exists to prove table-generality. Do not treat either as captured behavior fidelity; tune in editors/tuning, reshape the preset record when V21 lands.',
      evidence: ['cart/hmsc-int/game/activities/verbs.ts', 'cart/hmsc-int/game/activities/CAPTURE.md (judgment calls 1–2)'],
      severity: 'medium',
    },
    {
      name: 'one quality channel where scape designed two moments',
      purpose: ['game_loop'],
      description:
        'scape’s design separates cook quality (minQuality) from hand-off sloppiness; the capture collapses both into "any signal may carry quality, the run keeps the minimum". A second channel is an ADDITION requiring a verdict, not a refactor to sneak in.',
      evidence: ['cart/hmsc-int/game/activities/defs.ts (QualityPolicy)', 'cart/scape/design.ts (Order.minQuality)'],
      severity: 'low',
    },
  ],
};
