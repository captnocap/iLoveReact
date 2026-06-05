// activities.test.ts — P4 meaning tests for GAME_ACTIVITIES: an activity's
// loop advances on the state tick, completes, repeats, and pays what its
// table says. Behavior assertions only — written to survive interface
// changes.

import { GAME_ACTIVITIES, stageDurationMs } from './index';
import { ACTIVITY_VERBS, ACTIVITY_VERB_DEFINITIONS } from './verbs';
import { ACTIVITY_DEFINITIONS, defineActivity, getActivityDefinition, type ActivityDefinition } from './defs';
import { startRun, stepRun, restartRun, payoutCash, type ActivityEvent, type ActivityRun, type ActivitySignal } from './run';
import { activitiesStream } from './stream';
import { stateTickIntervalMs } from '../loop';
import { assert, assertClose, assertEqual, assertThrows, finish, test } from '../_testkit';

const DEALING = getActivityDefinition('dealing');
const RACE = getActivityDefinition('street-race');

/** drive a run N silent ticks (no player action) */
function ticks(run: ActivityRun, def: ActivityDefinition, count: number): { run: ActivityRun; events: ActivityEvent[] } {
  let current = run;
  const events: ActivityEvent[] = [];
  for (let i = 0; i < count; i += 1) {
    const step = stepRun(current, def);
    current = step.run;
    events.push(...step.events);
  }
  return { run: current, events };
}

function kinds(events: ActivityEvent[]): string[] {
  return events.map((event) => event.kind);
}

// ── the verb space (V22) ─────────────────────────────────────────────────────

test('the verb space is exactly the seven ruled verbs, in V22 order', () => {
  assertEqual(ACTIVITY_VERBS.join(','), 'role,rob,chase,evade,race,jump,accumulate',
    'V22: role, rob, chase, evade, race, jump, accumulate');
});

test('every verb is a distribution preset, not a system — data only, sealed', () => {
  for (const verb of ACTIVITY_VERBS) {
    const definition = ACTIVITY_VERB_DEFINITIONS[verb];
    assert(definition != null, `verb "${verb}" has a definition`);
    assert(Object.isFrozen(definition.preset), `"${verb}" preset is frozen data`);
    for (const value of Object.values(definition.preset)) {
      assertEqual(typeof value, 'number', `"${verb}" preset carries only numbers (P2 knobs)`);
    }
  }
});

test("'role' is the neutral preset — the baseline world, nothing dialed", () => {
  const preset = ACTIVITY_VERB_DEFINITIONS.role.preset;
  assertEqual(preset.copWeight, 1, 'neutral cop weight');
  assertEqual(preset.civilianWeight, 1, 'neutral civilian weight');
  assertEqual(preset.trafficWeight, 1, 'neutral traffic weight');
  assertEqual(preset.temperatureBias, 0, 'no temperature bias');
  assertEqual(preset.convergenceBias, 0, 'no convergence bias');
  assertEqual(preset.promotionBudgetWeight, 1, 'neutral promotion budget');
});

test('every shipped activity table plays under a ruled verb', () => {
  for (const def of Object.values(ACTIVITY_DEFINITIONS)) {
    assert((ACTIVITY_VERBS as readonly string[]).includes(def.verb), `"${def.key}" verb "${def.verb}" is ruled`);
  }
});

// ── the table boundary (P3 fail-loud) ───────────────────────────────────────

test('defineActivity rejects malformed tables at build time, loudly', () => {
  const base = { key: 'x', title: 'X', verb: 'role' as const, reward: {}, repeat: 'manual' as const };
  assertThrows(() => defineActivity({ ...base, stages: [] }), 'no stages');
  assertThrows(() => defineActivity({ ...base, verb: 'fly' as never, stages: [{ id: 'a', brief: '', advance: { kind: 'ticks', ticks: 1 } }] }), 'verb outside the V22 space');
  assertThrows(() => defineActivity({ ...base, stages: [
    { id: 'a', brief: '', advance: { kind: 'ticks', ticks: 1 } },
    { id: 'a', brief: '', advance: { kind: 'ticks', ticks: 1 } },
  ] }), 'duplicate stage ids');
  assertThrows(() => defineActivity({ ...base, stages: [{ id: 'a', brief: '', advance: { kind: 'ticks', ticks: 0 } }] }), 'zero-tick stage');
  assertThrows(() => defineActivity({ ...base, stages: [{ id: 'a', brief: '', advance: { kind: 'signalWithin', signal: 'go', ticks: 2.5 } }] }), 'fractional ticks');
  assertThrows(() => defineActivity({
    ...base,
    stages: [{ id: 'a', brief: '', advance: { kind: 'ticks', ticks: 1 } }],
    quality: { payoutFloor: 1.5, sloppyBelow: 0.3, sloppyHeatDelta: 1 },
  }), 'payout floor outside [0,1]');
  assertThrows(() => getActivityDefinition('no-such-loop'), 'unknown key fails loud');
});

// ── the loop advances on the tick (V8 cadence) ──────────────────────────────

test('a timed stage advances on the tick — and not before its table says', () => {
  const { run } = startRun(DEALING);
  const cookTicks = (DEALING.stages[0].advance as { ticks: number }).ticks;
  const early = ticks(run, DEALING, cookTicks - 1);
  assertEqual(early.run.stageIndex, 0, 'still cooking one tick before the table says');
  assertEqual(early.events.length, 0, 'no events while the table says wait');
  const done = ticks(run, DEALING, cookTicks);
  assertEqual(done.run.stageIndex, 1, 'cook completes exactly at its tick count');
  assertEqual(kinds(done.events).join(','), 'stageAdvanced', 'one stageAdvanced, nothing else');
});

test('an open signal stage waits for the report, however many ticks pass', () => {
  const stakeout = defineActivity({
    key: 'stakeout', title: 'Stakeout', verb: 'role',
    stages: [{ id: 'watch', brief: 'Watch the door', advance: { kind: 'signal', signal: 'spotted' } }],
    reward: { cash: 10 }, repeat: 'manual',
  });
  const { run } = startRun(stakeout);
  const waited = ticks(run, stakeout, 50);
  assertEqual(waited.run.status, 'active', 'no deadline on an open signal stage');
  const { run: doneRun, events } = stepRun(waited.run, stakeout, [{ signal: 'spotted' }]);
  assertEqual(doneRun.status, 'completed', 'the report completes it');
  assert(kinds(events).includes('paidOut'), 'completion pays');
});

test('a deadline stage fails when the window passes without the signal', () => {
  const { run } = startRun(DEALING);
  const cooked = ticks(run, DEALING, 3).run;
  const window = (DEALING.stages[1].advance as { ticks: number }).ticks;
  const missed = ticks(cooked, DEALING, window);
  assertEqual(missed.run.status, 'failed', 'the buyer walked');
  const failed = missed.events.find((event) => event.kind === 'failed');
  assert(failed != null && failed.kind === 'failed' && failed.stageId === 'deliver' && failed.reason === 'deadline',
    'failure names the stage and the reason');
});

// ── completion pays what the table says ─────────────────────────────────────

test('a full repetition pays exactly the table cash (+ the rest of the reward row)', () => {
  let { run } = startRun(RACE);
  const schedule: ActivitySignal[][] = [[{ signal: 'checkpoint' }], [{ signal: 'checkpoint' }], [{ signal: 'checkpoint' }], [{ signal: 'finish' }]];
  const events: ActivityEvent[] = [];
  for (const signals of schedule) {
    const step = stepRun(run, RACE, signals);
    run = step.run;
    events.push(...step.events);
  }
  assertEqual(run.status, 'completed', 'manual-repeat run parks at completed');
  const paid = events.find((event) => event.kind === 'paidOut');
  assert(paid != null && paid.kind === 'paidOut', 'completion pays');
  assertEqual(paid.cashPaid, RACE.reward.cash, 'cash is the table number, untouched (no quality policy)');
  assertEqual(paid.repDelta, RACE.reward.repDelta, 'the reward row travels whole');
  assertEqual(run.totalCashPaid, RACE.reward.cash, 'life total banks it');
});

test('quality scales the payout exactly per the table (fussy buyers pay for better)', () => {
  const floor = DEALING.quality!.payoutFloor;
  const cash = DEALING.reward.cash!;
  assertEqual(payoutCash(DEALING, 1), cash, 'perfect product pays full');
  assertEqual(payoutCash(DEALING, 0), Math.round(cash * floor), 'worst product pays the floor');
  assertEqual(payoutCash(DEALING, 0.5), Math.round(cash * (floor + (1 - floor) * 0.5)), 'half quality pays the line between');
});

test('a sloppy hand-off raises heat by the table delta — and still pays (degrades, never ends)', () => {
  let { run } = startRun(DEALING);
  run = ticks(run, DEALING, 3).run;
  const sloppy = DEALING.quality!.sloppyBelow - 0.1;
  const { events } = stepRun(run, DEALING, [{ signal: 'delivered', quality: sloppy }]);
  const heat = events.find((event) => event.kind === 'heatRaised');
  assert(heat != null && heat.kind === 'heatRaised', 'sloppy hand-off raises heat');
  assertEqual(heat.amount, DEALING.quality!.sloppyHeatDelta, 'by the table delta');
  const paid = events.find((event) => event.kind === 'paidOut');
  assert(paid != null && paid.kind === 'paidOut' && paid.cashPaid === payoutCash(DEALING, sloppy),
    'degraded payment still lands');
});

test('a clean hand-off raises no heat', () => {
  let { run } = startRun(DEALING);
  run = ticks(run, DEALING, 3).run;
  const { events } = stepRun(run, DEALING, [{ signal: 'delivered', quality: 0.9 }]);
  assert(!kinds(events).includes('heatRaised'), 'no heat above the sloppy line');
});

test('an out-of-range quality report throws at the boundary', () => {
  let { run } = startRun(DEALING);
  run = ticks(run, DEALING, 3).run;
  assertThrows(() => stepRun(run, DEALING, [{ signal: 'delivered', quality: 1.2 }]), 'quality must be in [0,1]');
});

// ── the loop repeats ─────────────────────────────────────────────────────────

test('an auto-repeat loop rolls straight into the next repetition and pays again', () => {
  let { run } = startRun(DEALING);
  const events: ActivityEvent[] = [];
  for (let repetition = 0; repetition < 2; repetition += 1) {
    run = ticks(run, DEALING, 3).run; // cook
    const step = stepRun(run, DEALING, [{ signal: 'delivered', quality: 1 }]);
    run = step.run;
    events.push(...step.events);
  }
  assertEqual(run.status, 'active', 'auto-repeat never parks');
  assertEqual(run.completions, 2, 'two repetitions completed');
  assertEqual(run.totalCashPaid, DEALING.reward.cash! * 2, 'paid the table twice');
  assertEqual(kinds(events).filter((kind) => kind === 'repeated').length, 2, 'each completion announces the repeat');
  assertEqual(run.quality, 1, 'quality resets per repetition');
});

test('a manual-repeat loop parks at completed; restartRun goes again', () => {
  const sprint = defineActivity({
    key: 'sprint', title: 'Sprint', verb: 'race',
    stages: [{ id: 'dash', brief: 'Run it', advance: { kind: 'ticks', ticks: 1 } }],
    reward: { cash: 5 }, repeat: 'manual',
  });
  let { run } = startRun(sprint);
  run = ticks(run, sprint, 1).run;
  assertEqual(run.status, 'completed', 'parked');
  const idle = stepRun(run, sprint);
  assert(idle.run === run && idle.events.length === 0, 'a parked run is inert — same reference, no events');
  const { run: again, events } = restartRun(run, sprint);
  assertEqual(again.status, 'active', 'restarted');
  assertEqual(again.stageIndex, 0, 'from the top');
  assertEqual(again.completions, 1, 'life totals carry over');
  assertEqual(kinds(events).join(','), 'repeated', 'the restart announces itself');
  const second = ticks(again, sprint, 1).run;
  assertEqual(second.completions, 2, 'and it completes again');
  assertEqual(second.totalCashPaid, 10, 'and pays again');
});

test('a failed run revives via restartRun — failure degrades, never ends (V22)', () => {
  let { run } = startRun(DEALING);
  run = ticks(run, DEALING, 3 + 12).run; // cook, then miss the whole delivery window
  assertEqual(run.status, 'failed', 'the run failed');
  const { run: revived } = restartRun(run, DEALING);
  assertEqual(revived.status, 'active', 'failure is always re-runnable');
  assertEqual(revived.quality, 1, 'fresh quality');
});

// ── determinism + purity (R6 / the perception precedent) ───────────────────

test('the same signal schedule yields byte-identical runs and events (R6)', () => {
  const play = () => {
    let { run, events } = startRun(DEALING);
    const all = [...events];
    for (let i = 0; i < 6; i += 1) {
      const step = stepRun(run, DEALING, i === 4 ? [{ signal: 'delivered', quality: 0.7 }] : []);
      run = step.run;
      all.push(...step.events);
    }
    return { run, all };
  };
  const a = play();
  const b = play();
  assertEqual(JSON.stringify(a.run), JSON.stringify(b.run), 'identical runs');
  assertEqual(JSON.stringify(a.all), JSON.stringify(b.all), 'identical event streams');
});

test('stepRun never mutates the run it was given', () => {
  const { run } = startRun(DEALING);
  const before = JSON.stringify(run);
  stepRun(run, DEALING, [{ signal: 'delivered', quality: 0.5 }]);
  ticks(run, DEALING, 5);
  assertEqual(JSON.stringify(run), before, 'the input run is untouched');
});

test('signals cascade within one tick — two checkpoints in one step advance two stages', () => {
  const { run } = startRun(RACE);
  const { run: after, events } = stepRun(run, RACE, [{ signal: 'checkpoint' }, { signal: 'checkpoint' }]);
  assertEqual(after.stageIndex, 2, 'two stages cleared in one tick');
  assertEqual(kinds(events).filter((kind) => kind === 'stageAdvanced').length, 2, 'both advances announced');
});

test('a mismatched run/definition pair throws instead of corrupting', () => {
  const { run } = startRun(DEALING);
  assertThrows(() => stepRun(run, RACE), 'stepRun checks the pair');
  assertThrows(() => restartRun({ ...run, status: 'failed' }, RACE), 'restartRun checks the pair');
});

// ── the cadence is GAME_LOOP's (V8 consumed, not redesigned) ────────────────

test('stage durations are state ticks × the ruled ~45/min interval', () => {
  const cook = DEALING.stages[0];
  assertClose(stageDurationMs(cook)!, 3 * stateTickIntervalMs(), 1e-9, 'cook spans 3 state ticks of wall time');
  const open = defineActivity({
    key: 'open-watch', title: 'Open watch', verb: 'role',
    stages: [{ id: 'w', brief: '', advance: { kind: 'signal', signal: 'x' } }],
    reward: {}, repeat: 'manual',
  });
  assertEqual(stageDurationMs(open.stages[0]), null, 'an open signal stage has no duration');
});

// ── the V20 stream ───────────────────────────────────────────────────────────

test('the activities stream materializes life totals from the engine events', () => {
  let { run, events } = startRun(DEALING);
  let all = [...events];
  for (let i = 0; i < 4; i += 1) {
    const step = stepRun(run, DEALING, i === 3 ? [{ signal: 'delivered', quality: 0.2 }] : []);
    run = step.run;
    all.push(...step.events);
  }
  let state = activitiesStream.initial();
  for (const event of all) state = activitiesStream.apply(state, event);
  assertEqual(state.totals.dealing.completions, 1, 'one completion folded');
  assertEqual(state.totals.dealing.cashPaid, payoutCash(DEALING, 0.2), 'cash folded post-scaling');
  assertEqual(state.heatRaised, DEALING.quality!.sloppyHeatDelta, 'the sloppy heat folded');
});

test('the stream tolerates events from the future (V20 schema evolution by addition)', () => {
  const state = activitiesStream.initial();
  const after = activitiesStream.apply(state, { kind: 'sponsored', defKey: 'dealing' } as never);
  assertEqual(JSON.stringify(after), JSON.stringify(state), 'unknown kinds pass through untouched');
});

test('the stream counts failures', () => {
  let { run } = startRun(DEALING);
  const folded = ticks(run, DEALING, 15);
  let state = activitiesStream.initial();
  for (const event of folded.events) state = activitiesStream.apply(state, event);
  assertEqual(state.totals.dealing.failures, 1, 'the missed window is on the record');
});

// ── the door (P3) ────────────────────────────────────────────────────────────

test('the door is sealed and live — tables, engine, stream, no grab-bag status', () => {
  assert(Object.isFrozen(GAME_ACTIVITIES), 'the door is frozen');
  assert(!('status' in GAME_ACTIVITIES), 'no capture-pending claim');
  assertEqual(GAME_ACTIVITIES.VERBS.length, 7, 'the verb space rides the door');
  assertEqual(typeof GAME_ACTIVITIES.startRun, 'function', 'the engine rides the door');
  assertEqual(GAME_ACTIVITIES.stream.name, 'activities', 'the V20 concern rides the door');
  assert(Object.isFrozen(GAME_ACTIVITIES.DEFINITIONS), 'tables are sealed');
});

finish('game/activities');
