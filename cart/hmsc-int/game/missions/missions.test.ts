// missions.test.ts — P4 meaning-tests for GAME_MISSIONS (V22/V8/V16/V20).
//
// Behavior, not function names: objective predicates read the queryable world
// as data, the closed row schema validates against the queryable future and
// prices from tuning (the LLM never touches numbers), the engine sequences
// stages on the state tick with forced-tick semantics, completion pays what
// the table says, bindings void/re-arm per V22, and the seams onto the V16
// clock / GAME_PATHING / GAME_STORY's log are proven, not claimed. Runs under
// tools/v8cli via `rjit game verify` (auto-discovered *.test.ts).

import { assert, assertEqual, assertThrows, finish, test } from '../_testkit';
import { evaluateObjective, objectiveMarker, resolveTargetNpc } from './objectives';
import type { MissionFacts, MissionObjective } from './objectives';
import { defineMission, getMissionDefinition, MISSION_DEFINITIONS } from './defs';
import type { MissionDef } from './defs';
import {
  fingerprintSimilarity, isDuplicateRow, missionFromRow, ROW_STAGE_ID, validateRow,
} from './rows';
import type { MissionAffordances, MissionRow } from './rows';
import { acceptMission, rearmMission, restartMission, stepMission } from './run';
import type { MissionEvent } from './run';
import { missionsStream } from './stream';
import { asStoryEventInput, briefingCutscene, expiryDurationMs } from './index';
import { MISSION_TUNING } from './tuning';
import { GAME_CUTSCENE } from '../cutscene';
import { GAME_PATHING } from '../pathing';
import { stateTickIntervalMs } from '../loop';
import {
  advanceArc, channelsFor, createEventLog, emptyStory, OPENING_ARC, recordEvent, setFlag, startArc,
} from '../story';

// ── shared fixtures ──────────────────────────────────────────────────────────

const AFFORDANCES: MissionAffordances = {
  npcs: ['marcus', 'dockhand-2'],
  positions: ['dock-foreman'],
  zones: ['old-docks'],
  sites: ['pawn-shop'],
  items: ['parcel', 'ledger'],
  methods: ['los-shot', 'tail-on-foot'],
};

function grievanceRow(overrides: Partial<MissionRow> = {}): MissionRow {
  return {
    key: 'daily-grievance-001',
    title: 'He knows what he did',
    verb: 'rob',
    client: 'anon-poster-77',
    binding: { kind: 'person', npcId: 'marcus' },
    objectives: [
      { kind: 'talk', brief: 'Find Marcus and have words', targetSlot: { kind: 'npc', id: 'marcus' } },
      { kind: 'acquire', brief: 'Take the ledger he carries', itemKey: 'ledger' },
    ],
    methodsHinted: ['tail-on-foot'],
    narrativeHooks: [
      { at: 'accept', text: 'Client note: he drinks at the docks after dark.', worldDelta: { rumorPlanted: 'old-docks' } },
      { at: 'complete', text: 'Payment released. Pleasure doing business.', worldDelta: { clientSatisfied: 'anon-poster-77' } },
    ],
    expiry: 'daily',
    collateral: 'standard',
    seed: 'seed-001',
    fingerprint: [0.1, 0.7, 0.2, 0.5],
    ...overrides,
  };
}

// ── objectives: the queryable world as data ──────────────────────────────────

test('every objective kind reads its fact and holds when the world says so', () => {
  const cases: [MissionObjective, MissionFacts][] = [
    [{ kind: 'kill', brief: 'k', target: { kind: 'npc', id: 'marcus' } }, { npcsDown: ['marcus'] }],
    [{ kind: 'reach', brief: 'r', target: { kind: 'zone', key: 'old-docks' } }, { zonesIn: ['old-docks'] }],
    [{ kind: 'reach', brief: 'r', target: { kind: 'point', x: 10, z: 10 } },
      { playerPosition: { x: 10 + MISSION_TUNING.reachRadiusMeters, z: 10 } }],
    [{ kind: 'earn', brief: 'e', amount: 500 }, { playerCash: 500 }],
    [{ kind: 'acquire', brief: 'a', itemKey: 'ledger' }, { inventory: ['ledger'] }],
    [{ kind: 'talk', brief: 't', target: { kind: 'npc', id: 'marcus' } }, { talkedTo: ['marcus'] }],
    [{ kind: 'evade', brief: 'v', amount: 20 }, { notoriety: 20 }],
    [{ kind: 'use_site', brief: 'u', target: { kind: 'site', key: 'pawn-shop' } }, { sitesUsed: ['pawn-shop'] }],
  ];
  for (const [objective, facts] of cases) {
    assert(evaluateObjective(objective, facts), `${objective.kind} holds when its fact says so`);
  }
});

test('an absent fact is never true — the engine only knows what it was told', () => {
  const empty: MissionFacts = {};
  const all: MissionObjective[] = [
    { kind: 'kill', brief: 'k', target: { kind: 'npc', id: 'marcus' } },
    { kind: 'reach', brief: 'r', target: { kind: 'point', x: 0, z: 0 } },
    { kind: 'earn', brief: 'e', amount: 0 },
    { kind: 'acquire', brief: 'a', itemKey: 'ledger' },
    { kind: 'talk', brief: 't', target: { kind: 'npc', id: 'marcus' } },
    { kind: 'evade', brief: 'v', amount: 100 },
    { kind: 'use_site', brief: 'u', target: { kind: 'site', key: 'pawn-shop' } },
  ];
  for (const objective of all) {
    assert(!evaluateObjective(objective, empty), `${objective.kind} cannot hold on an empty snapshot`);
  }
});

test('reach-point uses the tuning radius: inside holds, outside does not', () => {
  const objective: MissionObjective = { kind: 'reach', brief: 'r', target: { kind: 'point', x: 100, z: 50 } };
  const r = MISSION_TUNING.reachRadiusMeters;
  assert(evaluateObjective(objective, { playerPosition: { x: 100 + r * 0.99, z: 50 } }), 'inside the radius holds');
  assert(!evaluateObjective(objective, { playerPosition: { x: 100 + r * 1.01, z: 50 } }), 'outside the radius does not');
});

test('a position target resolves to its OCCUPANT (the V22 roster), not an npc id', () => {
  const objective: MissionObjective = { kind: 'kill', brief: 'k', target: { kind: 'position', id: 'dock-foreman' } };
  assertEqual(
    resolveTargetNpc(objective.target, { occupants: { 'dock-foreman': 'marcus' } }), 'marcus',
    'occupant resolution');
  assert(evaluateObjective(objective, { occupants: { 'dock-foreman': 'marcus' }, npcsDown: ['marcus'] }),
    'killing the occupant completes a position-targeted objective');
  assert(!evaluateObjective(objective, { npcsDown: ['marcus'] }),
    'a vacant/unknown position resolves to nobody — the objective cannot hold');
});

test('evade is a notoriety CEILING (scape: "notoriety ceiling for evade")', () => {
  const objective: MissionObjective = { kind: 'evade', brief: 'v', amount: 30 };
  assert(evaluateObjective(objective, { notoriety: 29 }), 'below the ceiling holds');
  assert(!evaluateObjective(objective, { notoriety: 31 }), 'above the ceiling does not');
});

test('objectiveMarker: explicit marker wins, point targets self-mark, others have none', () => {
  assertEqual(objectiveMarker({ kind: 'acquire', brief: 'a', itemKey: 'parcel', marker: { x: 12, z: -4 } })?.x, 12,
    'explicit marker');
  const point = objectiveMarker({ kind: 'reach', brief: 'r', target: { kind: 'point', x: 220, z: 145 } });
  assertEqual(point?.z, 145, 'point target is its own marker');
  assertEqual(objectiveMarker({ kind: 'talk', brief: 't', target: { kind: 'npc', id: 'marcus' } }), null,
    'an npc objective has no static blip');
});

// ── defs: the tables validate loud ───────────────────────────────────────────

function minimalDef(overrides: Partial<MissionDef> = {}): MissionDef {
  return {
    key: 'test-mission',
    title: 'Test',
    verb: 'rob',
    client: 'tester',
    stages: [{ id: 's1', brief: 'do it', objectives: [{ kind: 'earn', brief: 'earn', amount: 10 }] }],
    reward: { cash: 100 },
    expiryTicks: null,
    collateral: { ratingDeltaPerCivilianKill: 1 },
    hooks: [],
    ...overrides,
  };
}

test('defineMission rejects malformed tables at build time, loudly', () => {
  assertThrows(() => defineMission(minimalDef({ verb: 'banana' as never })), 'unknown verb');
  assertThrows(() => defineMission(minimalDef({ stages: [] })), 'no stages');
  assertThrows(() => defineMission(minimalDef({
    stages: [
      { id: 's1', brief: 'a', objectives: [{ kind: 'earn', brief: 'e', amount: 1 }] },
      { id: 's1', brief: 'b', objectives: [{ kind: 'earn', brief: 'e', amount: 2 }] },
    ],
  })), 'duplicate stage id');
  assertThrows(() => defineMission(minimalDef({
    stages: [{ id: 's1', brief: 'a', objectives: [{ kind: 'kill', brief: 'k', target: { kind: 'zone', key: 'z' } } as never] }],
  })), 'kill cannot target a zone');
  assertThrows(() => defineMission(minimalDef({
    stages: [{ id: 's1', brief: 'a', objectives: [{ kind: 'earn', brief: 'e' }] }],
  })), 'earn without amount');
  assertThrows(() => defineMission(minimalDef({
    hooks: [{ at: 'complete', text: 'empty promise', worldDelta: {} }],
  })), 'a hook without a delta is a liar (V22)');
  assertThrows(() => defineMission(minimalDef({
    hooks: [{ at: 'stage:ghost', text: 'x', worldDelta: { y: 'z' } }],
  })), 'a hook addressing an unknown stage');
});

test('the delivery gig encodes the ruled constraint: the unfair rating costs VISIBLE MONEY before the pivot', () => {
  const gig = getMissionDefinition('delivery-gig');
  const completeHook = gig.hooks.find((hook) => hook.at === 'complete');
  assert(completeHook !== undefined, 'the gig has a complete hook');
  const cashDelta = completeHook!.worldDelta.cashDelta as number;
  assert(typeof cashDelta === 'number' && cashDelta < 0, 'the delta costs money (negative cash)');
  assertEqual(completeHook!.worldDelta.setFlag, 'opening.unfair-rating.cost-paid',
    'the delta names the OPENING_ARC stage-5 gate the story capture pinned');
});

test('shipped tables are frozen data — a consumer cannot bend a mission', () => {
  const gig = MISSION_DEFINITIONS['delivery-gig'];
  assert(Object.isFrozen(gig), 'def frozen');
  assert(Object.isFrozen(gig.stages), 'stages frozen');
  assert(Object.isFrozen(gig.stages[0].objectives[0]), 'objectives frozen');
  assert(Object.isFrozen(gig.reward), 'reward frozen');
  assert(Object.isFrozen(gig.hooks[0].worldDelta), 'deltas frozen');
  assertThrows(() => getMissionDefinition('no-such-mission'), 'unknown key throws with the table list');
});

// ── rows: the closed schema against the queryable future ────────────────────

test('a well-formed row proves out against the queryable future', () => {
  const verdict = validateRow(grievanceRow(), AFFORDANCES);
  assertEqual(verdict.problems.join('; '), '', 'no problems');
  assert(verdict.ok, 'ok');
});

test('the validator COLLECTS every problem — ghost targets, unguaranteed methods, lying hooks', () => {
  const verdict = validateRow(grievanceRow({
    binding: { kind: 'person', npcId: 'ghost-npc' },
    objectives: [{ kind: 'talk', brief: 't', targetSlot: { kind: 'npc', id: 'nobody' } }],
    methodsHinted: ['wall-hack'],
    narrativeHooks: [{ at: 'accept', text: 'trust me', worldDelta: {} }],
  }), AFFORDANCES);
  assert(!verdict.ok, 'fails');
  assert(verdict.problems.some((p) => p.includes('ghost-npc')), 'ghost binding named');
  assert(verdict.problems.some((p) => p.includes('nobody')), 'ghost target named');
  assert(verdict.problems.some((p) => p.includes('wall-hack')), 'unguaranteed method named');
  assert(verdict.problems.some((p) => p.includes('world_delta')), 'lying hook named');
  assert(verdict.problems.length >= 4, 'collect-all, not first-fail');
});

test('THE NUMBERS LAW: a row carrying a number anywhere fails validation', () => {
  const verdict = validateRow(grievanceRow({
    narrativeHooks: [{ at: 'accept', text: 'pay is 500', worldDelta: { bonusCash: 500 } }],
  }), AFFORDANCES);
  assert(!verdict.ok, 'numeric slot fails');
  assert(verdict.problems.some((p) => p.includes('never touches numbers')), 'the law is named');
  // the fingerprint is generation provenance, exempt by schema
  assert(validateRow(grievanceRow(), AFFORDANCES).ok, 'fingerprint numbers are exempt');
});

test('missionFromRow prices the gig from tuning — reward, expiry, collateral', () => {
  const def = missionFromRow(grievanceRow(), AFFORDANCES);
  assertEqual(def.reward.cash, MISSION_TUNING.pricing.rob, 'cash priced by verb table');
  assertEqual(def.expiryTicks, MISSION_TUNING.expiry.daily, 'expiry from the semantic table');
  assertEqual(def.collateral.ratingDeltaPerCivilianKill,
    MISSION_TUNING.collateral.standard.ratingDeltaPerCivilianKill, 'collateral from the policy table');
  assertEqual(def.stages.length, 1, 'a row compiles to one stage');
  assertEqual(def.stages[0].id, ROW_STAGE_ID, 'the contract stage');
  assertEqual(def.stages[0].objectives.length, 2, 'objectives carried');
  assertEqual(def.seed, 'seed-001', 'provenance carried');
  assertThrows(() => missionFromRow(grievanceRow({ binding: { kind: 'person', npcId: 'ghost' } }), AFFORDANCES),
    'an invalid row cannot compile');
});

test('the dedup window: same seed or similar fingerprint is a double; outside the window is not', () => {
  const accepted = grievanceRow();
  assert(isDuplicateRow(grievanceRow({ key: 'other', fingerprint: [0.9, 0.1] }), [accepted]),
    'same seed = double');
  const similar = grievanceRow({ key: 'near', seed: 'seed-002' });
  assert(fingerprintSimilarity(similar.fingerprint, accepted.fingerprint) >= MISSION_TUNING.dedup.threshold,
    'identical fingerprints are maximally similar');
  assert(isDuplicateRow(similar, [accepted]), 'similar fingerprint = double');
  const different = grievanceRow({ key: 'far', seed: 'seed-003', fingerprint: [0.7, -0.1, 0.2, -0.5] });
  assert(!isDuplicateRow(different, [accepted]), 'a dissimilar row passes');
  const fillers: MissionRow[] = Array.from({ length: MISSION_TUNING.dedup.window }, (_, i) =>
    grievanceRow({ key: `filler-${i}`, seed: `filler-seed-${i}`, fingerprint: [1, 0, 0, 0] }));
  assert(!isDuplicateRow(grievanceRow({ key: 'aged-out' }), [accepted, ...fillers]),
    'the window slides — an old double ages out');
});

// ── the engine: scripted objectives on the state tick ───────────────────────

function contractDef(overrides: Partial<MissionDef> = {}): MissionDef {
  return defineMission(minimalDef({
    key: 'contract-x',
    binding: { kind: 'person', npcId: 'marcus' },
    stages: [
      {
        id: 'find',
        brief: 'Find him',
        objectives: [{ kind: 'reach', brief: 'reach the docks', target: { kind: 'zone', key: 'old-docks' } }],
      },
      {
        id: 'finish',
        brief: 'Finish it',
        objectives: [{ kind: 'kill', brief: 'kill marcus', target: { kind: 'npc', id: 'marcus' } }],
      },
    ],
    reward: { cash: 300, repDelta: 3 },
    expiryTicks: 10,
    collateral: { ratingDeltaPerCivilianKill: 1 },
    hooks: [
      { at: 'accept', text: 'He drinks at the docks.', worldDelta: { rumorPlanted: 'old-docks' } },
      { at: 'stage:finish', text: 'That is him by the crane.', worldDelta: { markerLit: 'marcus' } },
      { at: 'complete', text: 'Payment released.', worldDelta: { clientSatisfied: 'anon' } },
      { at: 'fail', text: 'Listing expired. The client moved on.', worldDelta: { listingPulled: 'contract-x' } },
    ],
    ...overrides,
  }));
}

test('accept arms the run and fires the accept + first-stage hooks', () => {
  const { run, events } = acceptMission(contractDef());
  assertEqual(run.status, 'active', 'active on accept');
  assertEqual(run.stageIndex, 0, 'at stage zero');
  assertEqual(run.rating, MISSION_TUNING.rating.base, 'rating starts at base');
  assertEqual(events[0].kind, 'accepted', 'accepted first');
  const hook = events.find((e) => e.kind === 'hookFired');
  assert(hook !== undefined && hook.kind === 'hookFired' && hook.at === 'accept', 'accept hook fired');
});

test('one call = ONE state tick: a bare tick only counts; objectives latch only when the facts say so', () => {
  const def = contractDef();
  let { run } = acceptMission(def);
  const bare = stepMission(run, def);
  assertEqual(bare.run.ticksActive, 1, 'the tick counted');
  assertEqual(bare.run.stageIndex, 0, 'no facts, no movement');
  assertEqual(bare.events.length, 0, 'a bare tick is silent');
  const moved = stepMission(bare.run, def, { facts: { zonesIn: ['old-docks'] } });
  assertEqual(moved.run.stageIndex, 1, 'the reach latched and the stage fell');
  assert(moved.events.some((e) => e.kind === 'objectiveComplete'), 'objectiveComplete emitted');
  assert(moved.events.some((e) => e.kind === 'stageAdvanced'), 'stageAdvanced emitted');
  assert(moved.events.some((e) => e.kind === 'hookFired' && e.at === 'stage:finish'), 'the stage hook fired on entry');
});

test('a forced tick is the SAME call with fresh facts — stages cascade when one tick reports everything', () => {
  const def = contractDef();
  const { run } = acceptMission(def);
  const result = stepMission(run, def, { facts: { zonesIn: ['old-docks'], npcsDown: ['marcus'] } });
  assertEqual(result.run.status, 'completed', 'both stages fell to one well-reported tick');
  const kinds = result.events.map((e) => e.kind);
  assert(kinds.includes('stageAdvanced') && kinds.includes('completed'), 'cascade emitted the full chain');
});

test('completion pays EXACTLY what the table says — the rating never scales pay', () => {
  const def = contractDef();
  const { run } = acceptMission(def);
  // dock the rating hard first, then complete
  const docked = stepMission(run, def, { civilianKills: 3 });
  const done = stepMission(docked.run, def, { facts: { zonesIn: ['old-docks'], npcsDown: ['marcus'] } });
  const paid = done.events.find((e) => e.kind === 'paidOut');
  assert(paid !== undefined && paid.kind === 'paidOut', 'paidOut emitted');
  assertEqual(paid!.cashPaid, 300, 'the table’s cash, untouched by the docked rating');
  assertEqual(paid!.repDelta, 3, 'the table’s repDelta carried');
  assertEqual(done.run.totalCashPaid, 300, 'life total recorded');
  const completed = done.events.find((e) => e.kind === 'completed');
  assert(completed !== undefined && completed.kind === 'completed', 'completed emitted');
  assertEqual(completed!.rating, MISSION_TUNING.rating.base - 3, 'the docked rating is the RECORD');
  assert(done.events.some((e) => e.kind === 'hookFired' && e.at === 'complete'), 'complete hooks fired');
});

test('collateral docks the rating per the table’s policy, floored at min (V22)', () => {
  const def = contractDef({ collateral: { ratingDeltaPerCivilianKill: 2 } });
  const { run } = acceptMission(def);
  const one = stepMission(run, def, { civilianKills: 1 });
  assertEqual(one.run.rating, MISSION_TUNING.rating.base - 2, 'one kill, policy delta');
  const dockEvent = one.events.find((e) => e.kind === 'ratingDocked');
  assert(dockEvent !== undefined, 'ratingDocked emitted');
  const many = stepMission(one.run, def, { civilianKills: 50 });
  assertEqual(many.run.rating, MISSION_TUNING.rating.min, 'the floor holds');
  assertEqual(many.run.civilianKills, 51, 'kills counted');
});

test('the listing expires at the table’s tick exactly — fail hooks fire, reason named', () => {
  const def = contractDef({ expiryTicks: 3 });
  let { run } = acceptMission(def);
  run = stepMission(run, def).run;
  run = stepMission(run, def).run;
  assertEqual(run.status, 'active', 'alive at tick 2');
  const expired = stepMission(run, def);
  assertEqual(expired.run.status, 'failed', 'failed at tick 3');
  const failed = expired.events.find((e) => e.kind === 'failed');
  assert(failed !== undefined && failed.kind === 'failed' && failed.reason === 'expired', 'reason: expired');
  assert(expired.events.some((e) => e.kind === 'hookFired' && e.at === 'fail'), 'fail hooks fired');
});

test('failure degrades, never ends: a failed listing restarts; voided NEVER revives (the one fail screen)', () => {
  const def = contractDef({ expiryTicks: 1 });
  const failed = stepMission(acceptMission(def).run, def);
  assertEqual(failed.run.status, 'failed', 'expired');
  const revived = restartMission(failed.run, def, );
  assertEqual(revived.run.status, 'active', 'failed restarts');
  assertEqual(revived.run.ticksActive, 0, 'fresh clock');
  assert(revived.events.some((e) => e.kind === 'restarted'), 'restarted emitted');
  // unrelated death voids the person-bound contract
  const killDef = contractDef();
  const { run } = acceptMission(killDef);
  const voided = stepMission(run, killDef, { facts: { npcsDown: ['marcus'], zonesIn: [] } });
  // marcus IS the kill target in stage 'finish' — his death is the mission's business, never voiding
  assertEqual(voided.run.status, 'active', 'a kill-target death is RELATED — no void');
  const talkDef = contractDef({
    key: 'talk-contract',
    stages: [{ id: 'meet', brief: 'Meet him', objectives: [{ kind: 'talk', brief: 't', target: { kind: 'npc', id: 'marcus' } }] }],
    hooks: [],
  });
  const talkRun = acceptMission(talkDef).run;
  const dead = stepMission(talkRun, talkDef, { facts: { npcsDown: ['marcus'] } });
  assertEqual(dead.run.status, 'voided', 'the grievance followed HIM — unrelated death voids');
  assert(dead.events.some((e) => e.kind === 'voided'), 'voided emitted');
  assertEqual(restartMission(dead.run, talkDef).run.status, 'voided', 'voided never restarts');
  assertThrows(() => rearmMission(dead.run, talkDef, 'replacement'), 'person contracts never re-arm');
});

test('a POSITION-bound contract arms against the occupant and RE-ARMS against the replacement (V22)', () => {
  const def = contractDef({
    key: 'racket-foreman',
    binding: { kind: 'position', positionId: 'dock-foreman' },
    stages: [{
      id: 'hit',
      brief: 'Vacate the post',
      objectives: [{ kind: 'kill', brief: 'kill the foreman', target: { kind: 'position', id: 'dock-foreman' } }],
    }],
    hooks: [],
  });
  const { run } = acceptMission(def, { occupants: { 'dock-foreman': 'marcus' } });
  assertEqual(run.occupantId, 'marcus', 'armed against the current occupant');
  // the occupant dies — the contract followed its ARMED occupant even though the post shows a replacement
  const done = stepMission(run, def, {
    facts: { npcsDown: ['marcus'], occupants: { 'dock-foreman': 'dockhand-2' } },
  });
  assertEqual(done.run.status, 'completed', 'killing the armed occupant completes');
  // the post refills; the racket re-lists against the replacement (diegetic replay)
  const rearmed = rearmMission(done.run, def, 'dockhand-2');
  assertEqual(rearmed.run.status, 'active', 're-armed');
  assertEqual(rearmed.run.occupantId, 'dockhand-2', 'against the replacement');
  assertEqual(rearmed.run.totalCashPaid, 300, 'life totals carry across re-arms');
  assert(rearmed.events.some((e) => e.kind === 'rearmed'), 'rearmed emitted');
  const second = stepMission(rearmed.run, def, { facts: { npcsDown: ['marcus', 'dockhand-2'] } });
  assertEqual(second.run.status, 'completed', 'the re-armed contract completes against the replacement');
  assertEqual(second.run.totalCashPaid, 600, 'paid twice across the listing’s life');
});

test('a vacant position is the exploitable window — nothing to kill, the contract waits', () => {
  const def = contractDef({
    key: 'racket-vacant',
    binding: { kind: 'position', positionId: 'dock-foreman' },
    stages: [{
      id: 'hit', brief: 'v',
      objectives: [{ kind: 'kill', brief: 'k', target: { kind: 'position', id: 'dock-foreman' } }],
    }],
    hooks: [],
    expiryTicks: null,
  });
  const { run } = acceptMission(def, {});
  assertEqual(run.occupantId, null, 'vacant post — armed against nobody');
  const tick = stepMission(run, def, { facts: { npcsDown: ['marcus', 'dockhand-2'] } });
  assertEqual(tick.run.status, 'active', 'no occupant, no completion — vacancy is a world state');
});

test('the engine is pure: a parked run is the SAME reference; priors never mutate; same inputs = byte-identical', () => {
  const def = contractDef();
  const { run } = acceptMission(def);
  const before = JSON.stringify(run);
  const a = stepMission(run, def, { facts: { zonesIn: ['old-docks'] }, civilianKills: 1 });
  const b = stepMission(run, def, { facts: { zonesIn: ['old-docks'] }, civilianKills: 1 });
  assertEqual(JSON.stringify(a.run), JSON.stringify(b.run), 'byte-identical runs (R6)');
  assertEqual(JSON.stringify(a.events), JSON.stringify(b.events), 'byte-identical events');
  assertEqual(JSON.stringify(run), before, 'the prior run never mutates');
  const done = stepMission(a.run, def, { facts: { zonesIn: ['old-docks'], npcsDown: ['marcus'] } });
  const parked = stepMission(done.run, def, { facts: { zonesIn: ['old-docks'] } });
  assert(parked.run === done.run, 'a parked (completed) run returns the SAME reference');
  assertEqual(parked.events.length, 0, 'and is silent');
});

// ── completion/rewards plumbing: the V20 stream + the cross-door seams ───────

test('the V20 missions stream folds outcomes per VERB — tomorrow’s generation weights’ input', () => {
  const events: MissionEvent[] = [
    { kind: 'completed', defKey: 'a', verb: 'rob', rating: 5 },
    { kind: 'paidOut', defKey: 'a', cashPaid: 300 },
    { kind: 'completed', defKey: 'b', verb: 'rob', rating: 3 },
    { kind: 'paidOut', defKey: 'b', cashPaid: 300 },
    { kind: 'failed', defKey: 'c', verb: 'race', reason: 'expired', stageId: 's' },
    { kind: 'voided', defKey: 'd', verb: 'rob', npcId: 'marcus' },
    { kind: 'ratingDocked', defKey: 'a', amount: 2, rating: 3 },
  ];
  const state = events.reduce(missionsStream.apply, missionsStream.initial());
  assertEqual(state.perVerb.rob.completed, 2, 'rob completions tallied');
  assertEqual(state.perVerb.rob.ratingSum, 8, 'rating sum feeds the weights');
  assertEqual(state.perVerb.rob.voided, 1, 'voids tallied');
  assertEqual(state.perVerb.race.failed, 1, 'failures tallied by verb');
  assertEqual(state.cashPaid, 600, 'cash accumulated');
  assertEqual(state.collateralDocks, 2, 'collateral recorded');
  const unknown = missionsStream.apply(state, { kind: 'fromTheFuture' } as never);
  assertEqual(JSON.stringify(unknown), JSON.stringify(state), 'unknown kinds pass through untouched (V20)');
});

test('THE STORY-LOG SEAM: a fired hook records through GAME_STORY — the world_delta gains the log’s provenance', () => {
  const def = contractDef();
  const { events } = acceptMission(def);
  const hook = events.find((e) => e.kind === 'hookFired')!;
  const input = asStoryEventInput(hook, '2026-06-04T12:00:00.000Z');
  assertEqual(input.type, 'mission.hookFired', 'dot-namespaced type');
  const { log, event } = recordEvent(createEventLog(), input);
  assert(event.id.length > 0, 'the log assigned the id the world references');
  assertEqual((event.payload.worldDelta as Record<string, unknown>).rumorPlanted, 'old-docks',
    'the delta rides the payload — a witnessed fact now');
  assert(channelsFor(event).some((c) => c.endsWith(':tag:mission')), 'fans out on the mission tag channel');
  assertEqual(log.recent.length, 1, 'recorded');
});

test('THE V16 SEAM: the briefing is a cutscene on the one clock — sampled, scrubbed, identical', () => {
  const def = contractDef();
  const briefing = briefingCutscene(def);
  assert(briefing !== null, 'accept hooks make a briefing');
  const scene = GAME_CUTSCENE.create(briefing!);
  const mid = MISSION_TUNING.briefing.lineSeconds / 2;
  const frame = GAME_CUTSCENE.sample(scene, mid);
  assertEqual(frame.dialog.length, 1, 'the client is speaking');
  assertEqual(frame.dialog[0].speaker, def.client, 'spoken by the client (two-sided missions fall out free)');
  assertEqual(frame.dialog[0].text, 'He drinks at the docks.', 'the accept-hook line');
  const there = GAME_CUTSCENE.sample(scene, scene.duration);
  assert(there.done, 'the clock ends');
  const back = GAME_CUTSCENE.sample(scene, mid);
  assertEqual(JSON.stringify(back), JSON.stringify(frame), 'scrubbing back yields the identical frame (V16)');
  assertEqual(briefingCutscene(defineMission(minimalDef({ key: 'hookless' }))), null, 'no accept hooks, no briefing');
});

test('THE PATHING SEAM: an objective’s marker feeds GAME_PATHING — plan to the blip, arrive by plan end', () => {
  const gig = getMissionDefinition('delivery-gig');
  const marker = objectiveMarker(gig.stages[0].objectives[0])!;
  assert(marker !== null, 'the pickup has a blip');
  const plan = GAME_PATHING.planMotion([[0, 0], [marker.x, marker.z]], {
    startTime: 0,
    profile: { maxSpeed: 4, accel: 8, decel: 8 },
  });
  const arrived = GAME_PATHING.sampleMotion(plan, plan.t0 + plan.duration);
  assert(Math.hypot(arrived.x - marker.x, arrived.z - marker.z) < 0.01, 'the plan ends at the marker');
  assert(arrived.done, 'motion done');
});

test('expiryDurationMs is the one tick→wall conversion, consuming GAME_LOOP’s ruled cadence', () => {
  const def = contractDef({ expiryTicks: 45 });
  assertEqual(expiryDurationMs(def), 45 * stateTickIntervalMs(), '45 ticks = one ruled minute');
  assertEqual(expiryDurationMs(contractDef({ expiryTicks: null })), null, 'never-expiring has no duration');
});

test('THE OPENING CHAIN: completing the delivery gig’s delta gate advances OPENING_ARC stage 5 (V22)', () => {
  const gig = getMissionDefinition('delivery-gig');
  // play the gig to completion on forced ticks
  let { run } = acceptMission(gig);
  run = stepMission(run, gig, { facts: { inventory: ['parcel'] } }).run;
  const done = stepMission(run, gig, { facts: { inventory: ['parcel'], playerPosition: { x: 220, z: 145 } } });
  assertEqual(done.run.status, 'completed', 'the gig completes');
  const completeHook = done.events.find((e) => e.kind === 'hookFired' && e.at === 'complete');
  assert(completeHook !== undefined && completeHook.kind === 'hookFired', 'the unfair-rating hook fired');
  // the shell applies the delta: visible money out, the pinned flag set
  const gateFlag = completeHook!.worldDelta.setFlag as string;
  let story = emptyStory();
  for (const earlier of ['opening.dream.done', 'opening.wake.done', 'opening.fired.done', 'opening.job-hunt.done']) {
    story = setFlag(story, earlier, true);
  }
  story = setFlag(story, gateFlag, true);
  const arc = advanceArc(OPENING_ARC, startArc(OPENING_ARC), story, { occurredAt: '2026-06-04T12:00:00.000Z' });
  assertEqual(OPENING_ARC.stages[arc.state.stage].id, 'tweaker-scare',
    'the arc stands past delivery-gig — the cost-paid gate fell to the mission’s delta');
});

finish('missions');
