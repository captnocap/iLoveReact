// story.test.ts — P4 meaning-tests for GAME_STORY (V12/V22).
//
// Behavior, not function names: flags set/read/persist semantics, arc
// advancement on consequence events, dialog selection rules. Runs under
// tools/v8cli via `rjit game verify` (auto-discovered *.test.ts).

import { assert, assertEqual, assertThrows, finish, test } from '../_testkit';
import {
  emptyStory, setFlag, getFlag, flagIsSet, bumpCounter, getCounter, reviveStory,
} from './flags';
import { STORY_TUNING } from './tuning';
import {
  channelsFor, createEventLog, eventImportance, findEvent, murderEventInput, recordEvent,
} from './events';
import type { StoryEvent } from './events';
import { applyRules, STORY_RULES } from './rules';
import { advanceArc, arcDone, createArc, currentStage, OPENING_ARC, startArc } from './arcs';
import { emptyCase, makeWitnessMemory, reportToCase } from '../perception';

const T0 = '2026-06-04T12:00:00.000Z';

/** record a bare event for test input */
function liveEvent(type: string, extra: Partial<Parameters<typeof recordEvent>[1]> = {}): StoryEvent {
  return recordEvent(createEventLog(), { type, source: 'test', occurredAt: T0, ...extra }).event;
}

// ── flags: set / read ────────────────────────────────────────────────────────

test('a set flag reads back; an unset flag reads undefined and is not set', () => {
  const story = setFlag(emptyStory(), 'lab.figure.visited', true);
  assertEqual(getFlag(story, 'lab.figure.visited'), true, 'set flag reads back');
  assert(flagIsSet(story, 'lab.figure.visited'), 'set flag is truthy');
  assertEqual(getFlag(story, 'never.set'), undefined, 'unset flag reads undefined');
  assert(!flagIsSet(story, 'never.set'), 'unset flag is not set');
});

test('flags hold all three StoryValue kinds', () => {
  let story = emptyStory();
  story = setFlag(story, 'tutorial.done', true);
  story = setFlag(story, 'delivery.rating', 2.5);
  story = setFlag(story, 'apartment.prop', 'pawn-ticket');
  assertEqual(getFlag(story, 'tutorial.done'), true, 'boolean flag');
  assertEqual(getFlag(story, 'delivery.rating'), 2.5, 'number flag');
  assertEqual(getFlag(story, 'apartment.prop'), 'pawn-ticket', 'string flag');
});

test('re-setting the same value returns the SAME reference (re-render citizenship)', () => {
  const once = setFlag(emptyStory(), 'trigger.gate.seen', true);
  const twice = setFlag(once, 'trigger.gate.seen', true);
  assert(twice === once, 'identical set must not produce a new state object');
  const changed = setFlag(once, 'trigger.gate.seen', false);
  assert(changed !== once, 'a real change must produce a new state object');
});

test('a flag write never mutates the prior state (history safety)', () => {
  const before = setFlag(emptyStory(), 'a', 1);
  setFlag(before, 'b', 2);
  assertEqual(getFlag(before, 'b'), undefined, 'prior state must not grow new flags');
});

// ── counters ─────────────────────────────────────────────────────────────────

test('counters tally from zero; bump defaults to +1; delta 0 is a same-ref no-op', () => {
  let story = emptyStory();
  assertEqual(getCounter(story, 'deaths'), 0, 'unset counter reads 0');
  story = bumpCounter(story, 'deaths');
  story = bumpCounter(story, 'deaths', 2);
  assertEqual(getCounter(story, 'deaths'), 3, 'bumps accumulate');
  const same = bumpCounter(story, 'deaths', 0);
  assert(same === story, 'delta 0 must return the same reference');
  assertThrows(() => bumpCounter(story, 'deaths', NaN), 'non-finite delta must throw');
});

// ── persistence: the revive merge semantics ──────────────────────────────────

test('story state survives a JSON round-trip exactly', () => {
  let story = emptyStory();
  story = setFlag(story, 'lab.combat.visited', true);
  story = setFlag(story, 'client.handle', 'mr_clean');
  story = bumpCounter(story, 'gigs.completed', 4);
  const revived = reviveStory(JSON.parse(JSON.stringify(story)));
  assertEqual(getFlag(revived, 'lab.combat.visited'), true, 'boolean survives');
  assertEqual(getFlag(revived, 'client.handle'), 'mr_clean', 'string survives');
  assertEqual(getCounter(revived, 'gigs.completed'), 4, 'counter survives');
});

test('revive is defensive: garbage, missing fields, and wrong types yield a clean story', () => {
  assertEqual(getCounter(reviveStory(null), 'x'), 0, 'null → empty story');
  assertEqual(getFlag(reviveStory('not an object'), 'x'), undefined, 'string → empty story');
  const partial = reviveStory({ flags: { ok: true } });
  assertEqual(getFlag(partial, 'ok'), true, 'present flags merge');
  assertEqual(getCounter(partial, 'x'), 0, 'missing counters default');
  const dirty = reviveStory({
    flags: { good: 'yes', bad: { nested: 1 }, alsoBad: Infinity },
    counters: { good: 7, bad: 'NaN' },
  });
  assertEqual(getFlag(dirty, 'good'), 'yes', 'valid flag kept');
  assertEqual(getFlag(dirty, 'bad'), undefined, 'object-valued flag dropped');
  assertEqual(getFlag(dirty, 'alsoBad'), undefined, 'non-finite number flag dropped');
  assertEqual(getCounter(dirty, 'good'), 7, 'valid counter kept');
  assertEqual(getCounter(dirty, 'bad'), 0, 'string counter dropped');
});

// ── the event log: the vocabulary the Case references ────────────────────────

test('events get monotonic serials and hmsc-shaped ids; the log is append-only', () => {
  let log = createEventLog();
  const first = recordEvent(log, { type: 'lab.entered', source: 'test', occurredAt: T0 });
  const second = recordEvent(first.log, { type: 'lab.exited', source: 'test', occurredAt: T0 });
  assertEqual(first.event.id, 'hmsc_evt_000001', 'id carries the zero-padded serial');
  assertEqual(second.event.serial, 2, 'serials are monotonic');
  assertEqual(second.log.recent.length, 2, 'both events in the ring');
  assertEqual(findEvent(second.log, 'hmsc_evt_000001')?.type, 'lab.entered', 'events are findable by id');
  assertEqual(log.recent.length, 0, 'the prior log is untouched (pure append)');
});

test('the recent ring caps at the tuned limit but serials keep counting', () => {
  let log = createEventLog();
  const total = STORY_TUNING.recentEventCap + 10;
  for (let i = 0; i < total; i++) {
    log = recordEvent(log, { type: 'tick', source: 'test', occurredAt: T0 }).log;
  }
  assertEqual(log.recent.length, STORY_TUNING.recentEventCap, 'ring holds exactly the cap');
  assertEqual(log.recent[log.recent.length - 1].serial, total, 'newest survives');
  assertEqual(log.nextSerial, total + 1, 'serial counter never resets');
});

test('payloads are copied in — mutating the input later cannot rewrite history', () => {
  const payload: Record<string, unknown> = { rating: 1 };
  const { event } = recordEvent(createEventLog(), {
    type: 'gig.rated', source: 'test', occurredAt: T0, payload,
  });
  payload.rating = 5;
  assertEqual(event.payload.rating, 1, 'the logged payload keeps the recorded value');
});

test('an event without type, source, or stamp is rejected at the boundary', () => {
  const log = createEventLog();
  assertThrows(() => recordEvent(log, { type: '', source: 'test', occurredAt: T0 }), 'missing type throws');
  assertThrows(() => recordEvent(log, { type: 'x', source: '', occurredAt: T0 }), 'missing source throws');
  assertThrows(() => recordEvent(log, { type: 'x', source: 'test', occurredAt: undefined as any }), 'missing stamp throws');
});

test('channel fan-out and importance match the hmsc publication contract', () => {
  const { event } = recordEvent(createEventLog(), {
    type: 'story.flag.set', source: 'test', occurredAt: T0,
    actor: { kind: 'story', id: 'story.rules' },
    subject: { kind: 'lab', id: 'figure' },
    tags: ['story'],
  });
  const channels = channelsFor(event);
  assert(channels.includes('hmsc:event'), 'root channel');
  assert(channels.includes('hmsc:event:story.flag.set'), 'per-type channel');
  assert(channels.includes('hmsc:actor:story:story.rules'), 'actor channel');
  assert(channels.includes('hmsc:subject:lab:figure'), 'subject channel');
  assert(channels.includes('hmsc:tag:story'), 'tag channel');
  assertEqual(eventImportance(event), STORY_TUNING.importance.story, 'story.* importance');
  assertEqual(eventImportance(liveEvent('command.executed')), STORY_TUNING.importance.command, 'command importance');
  assertEqual(eventImportance(liveEvent('world.trigger.entered')), STORY_TUNING.importance.trigger, 'trigger importance');
  assertEqual(eventImportance(liveEvent('entity.spawned')), STORY_TUNING.importance.default, 'default importance');
});

test('a murder is an event the Case can reference by id (the deferred V12 wiring)', () => {
  const signature = { silhouette: 'avg', color: 'red', accessory: 'hood' } as const;
  const { event } = recordEvent(createEventLog(), murderEventInput({
    victimId: 'npc-7',
    murderKey: 'silenced-pistol',
    position: { x: 12, z: 40 },
    zone: 'docks',
    perpetratorSignature: signature,
    witnesses: ['npc-3'],
  }, T0));
  assertEqual(event.type, 'murder.committed', 'the murder is a typed event');
  assertEqual(event.subject?.id, 'npc-7', 'the victim is the subject');
  // the chain: witness memory holds the EVENT ID; reporting files that id on the Case
  const memory = makeWitnessMemory(event.id, signature, { x: 12, z: 40 }, 0, 0.8);
  const { kase } = reportToCase(emptyCase(), 'npc-3', memory);
  assert(kase.events.includes(event.id), 'the Case references the logged murder by id');
});

// ── rules: consequence events become flags (the hmsc story rules) ────────────

test('lab.entered sets lab.<name>.visited and yields a provenance event', () => {
  const trigger = liveEvent('lab.entered', { subject: { kind: 'lab', id: 'figure' } });
  const { story, effects } = applyRules(STORY_RULES, emptyStory(), trigger);
  assertEqual(getFlag(story, 'lab.figure.visited'), true, 'the visited flag is set');
  assertEqual(effects.length, 1, 'one story.flag.set effect');
  assertEqual(effects[0].type, 'story.flag.set', 'effect type');
  assertEqual(effects[0].parentId, trigger.id, 'provenance points at the trigger');
  assertEqual((effects[0].payload as any).flag, 'lab.figure.visited', 'payload names the flag');
});

test('a re-fired event sets nothing twice: same story reference, zero effects', () => {
  const trigger = liveEvent('lab.entered', { subject: { kind: 'lab', id: 'figure' } });
  const once = applyRules(STORY_RULES, emptyStory(), trigger);
  const twice = applyRules(STORY_RULES, once.story, trigger);
  assert(twice.story === once.story, 'no new state object');
  assertEqual(twice.effects.length, 0, 'no duplicate provenance event');
});

test('trigger-seen requires a label; the subject id keys the flag', () => {
  const unlabeled = liveEvent('world.trigger.entered', { subject: { kind: 'world', id: 'gate-3' } });
  assertEqual(applyRules(STORY_RULES, emptyStory(), unlabeled).effects.length, 0, 'no label → rule not applicable');
  const labeled = liveEvent('world.trigger.entered', {
    subject: { kind: 'world', id: 'gate-3' }, payload: { label: 'North Gate' },
  });
  const { story } = applyRules(STORY_RULES, emptyStory(), labeled);
  assertEqual(getFlag(story, 'trigger.gate-3.seen'), true, 'flag keyed by subject id');
});

test('events of other types fall through every rule untouched', () => {
  const stray = liveEvent('entity.spawned', { subject: { kind: 'entity', id: 'e1' } });
  const before = emptyStory();
  const { story, effects } = applyRules(STORY_RULES, before, stray);
  assert(story === before, 'a stray event returns the same story reference');
  assertEqual(effects.length, 0, 'no effects');
});

// ── arcs: advancement on consequence events + state gates ────────────────────

const HEIST_ARC = createArc({
  id: 'heist',
  stages: [
    { id: 'case-the-joint', advanceOn: { kind: 'flag', flag: 'heist.cased' } },
    { id: 'the-job', advanceOn: { kind: 'event', type: 'murder.committed', subjectId: 'npc-guard' } },
    { id: 'lay-low', advanceOn: { kind: 'counter', counter: 'days.survived', atLeast: 2 } },
  ],
});

test('an arc advances on its consequence event — and only the matching one', () => {
  const state = { arc: 'heist', stage: 1 };
  const wrongSubject = liveEvent('murder.committed', { subject: { kind: 'npc', id: 'npc-bystander' } });
  const miss = advanceArc(HEIST_ARC, state, emptyStory(), { event: wrongSubject });
  assert(miss.state === state, 'a non-matching event moves nothing (same reference)');
  assertEqual(miss.effects.length, 0, 'no effects on a miss');

  const hit = liveEvent('murder.committed', { subject: { kind: 'npc', id: 'npc-guard' } });
  const moved = advanceArc(HEIST_ARC, state, emptyStory(), { event: hit });
  assertEqual(moved.state.stage, 2, 'the matching consequence event advances the beat');
  assertEqual(moved.effects[0].type, 'story.arc.advanced', 'advancement is logged');
  assertEqual(moved.effects[0].parentId, hit.id, 'provenance points at the consequence event');
  assertEqual((moved.effects[0].payload as any).from, 'the-job', 'payload names the beat passed');
});

test('state-gated stages cascade in one call; an event moves at most one beat', () => {
  // flag for stage 1 already true AND the event for stage 2 arrives: both fall in one step
  let story = setFlag(emptyStory(), 'heist.cased', true);
  const hit = liveEvent('murder.committed', { subject: { kind: 'npc', id: 'npc-guard' } });
  const result = advanceArc(HEIST_ARC, startArc(HEIST_ARC), story, { event: hit });
  assertEqual(result.state.stage, 2, 'flag stage + event stage fall together');
  assertEqual(result.effects.length, 2, 'one advancement event per beat');
  // but a second event-gated stage could NOT also consume the same event:
  const doubleEvent = createArc({
    id: 'double',
    stages: [
      { id: 'a', advanceOn: { kind: 'event', type: 'boom' } },
      { id: 'b', advanceOn: { kind: 'event', type: 'boom' } },
    ],
  });
  const boom = liveEvent('boom');
  const once = advanceArc(doubleEvent, startArc(doubleEvent), emptyStory(), { event: boom });
  assertEqual(once.state.stage, 1, 'one event consumes one beat, never two');
});

test('completing the last stage logs story.arc.completed and the arc reads done', () => {
  const story = bumpCounter(emptyStory(), 'days.survived', 2);
  const result = advanceArc(HEIST_ARC, { arc: 'heist', stage: 2 }, story, { occurredAt: T0 });
  assert(arcDone(HEIST_ARC, result.state), 'arc is done');
  assertEqual(currentStage(HEIST_ARC, result.state), null, 'no current stage after done');
  assertEqual(result.effects[result.effects.length - 1].type, 'story.arc.completed', 'completion logged');
});

test('the V22 opening arc walks its seven ruled beats in order', () => {
  const beats = OPENING_ARC.stages.map((stage) => stage.id);
  assertEqual(beats.join(' → '),
    'sky-ramp-dream → wake-broke-high → fired → job-hunt → delivery-gig → tweaker-scare → crime-as-a-service',
    'the ruled beat order (V22, "The opening")');
  // the ruled constraint: the delivery-gig beat gates on the unfair rating COSTING money
  const gate = OPENING_ARC.stages[4].advanceOn;
  assert(gate.kind === 'flag' && gate.flag === 'opening.unfair-rating.cost-paid',
    'the unfair-rating beat must cost visible money before the pivot');
  // walk it: set each flag, advance, land on done
  let story = emptyStory();
  let state = startArc(OPENING_ARC);
  for (const stage of OPENING_ARC.stages) {
    const gateCondition = stage.advanceOn as { kind: 'flag'; flag: string };
    story = setFlag(story, gateCondition.flag, true);
    state = advanceArc(OPENING_ARC, state, story, { occurredAt: T0 }).state;
  }
  assert(arcDone(OPENING_ARC, state), 'all seven beats walked → opening complete');
});

test('arc defs are validated loud at build time', () => {
  assertThrows(() => createArc({ id: '', stages: [{ id: 'a', advanceOn: { kind: 'flag', flag: 'x' } }] }), 'missing arc id');
  assertThrows(() => createArc({ id: 'a', stages: [] }), 'zero stages');
  assertThrows(() => createArc({
    id: 'a',
    stages: [
      { id: 'dup', advanceOn: { kind: 'flag', flag: 'x' } },
      { id: 'dup', advanceOn: { kind: 'flag', flag: 'y' } },
    ],
  }), 'duplicate stage ids');
  assertThrows(() => advanceArc(HEIST_ARC, { arc: 'other', stage: 0 }, emptyStory(), { occurredAt: T0 }), 'mismatched arc state');
});

// ── dialog: selection rules ───────────────────────────────────────────────────

import {
  asCutsceneCue, createDialogSet, dialogAvailable, markSaid, selectDialog,
} from './dialog';
import { GAME_CUTSCENE } from '../cutscene';

const LINES = createDialogSet([
  { id: 'greet-cold', speaker: 'dispatcher', text: 'You again.' },
  {
    id: 'greet-after-gig', speaker: 'dispatcher', text: 'Heard about the rating. Rough.',
    requires: [{ kind: 'flag', flag: 'opening.unfair-rating.cost-paid' }], priority: 5,
  },
  {
    id: 'caas-pitch', speaker: 'tweaker', text: 'I know a guy. Pays in crypto.',
    requires: [
      { kind: 'flag', flag: 'opening.tweaker-scare.done' },
      { kind: 'counter', counter: 'gigs.completed', atLeast: 1 },
    ],
    priority: 9, once: true,
  },
]);

test('dialog selection is gated by story state — a line cannot know an unlogged fact', () => {
  const cold = selectDialog(LINES, emptyStory());
  assertEqual(cold.length, 1, 'only the ungated line at zero state');
  assertEqual(cold[0].id, 'greet-cold', 'the ungated greeting');

  let story = setFlag(emptyStory(), 'opening.unfair-rating.cost-paid', true);
  const afterGig = selectDialog(LINES, story);
  assertEqual(afterGig.map((line) => line.id).join(','), 'greet-after-gig,greet-cold',
    'flag unlocks the gated line; higher priority leads');

  story = setFlag(story, 'opening.tweaker-scare.done', true);
  assert(!dialogAvailable(LINES[2], story), 'counter gate still closed at 0 gigs');
  story = bumpCounter(story, 'gigs.completed', 1);
  assertEqual(selectDialog(LINES, story)[0].id, 'caas-pitch', 'all gates open → highest priority first');
});

test('a once-line latches through story state and never selects again', () => {
  let story = setFlag(emptyStory(), 'opening.tweaker-scare.done', true);
  story = bumpCounter(story, 'gigs.completed', 1);
  const pitch = LINES[2];
  assert(dialogAvailable(pitch, story), 'sayable before said');
  story = markSaid(story, pitch);
  assert(!dialogAvailable(pitch, story), 'said once → never again');
  assertEqual(getFlag(story, 'said.caas-pitch'), true, 'the latch is a plain flag (persists/revives)');
  // the latch survives persistence like any flag
  const revived = reviveStory(JSON.parse(JSON.stringify(story)));
  assert(!dialogAvailable(pitch, revived), 'the latch survives a save/load');
  // non-once lines latch nothing
  const same = markSaid(story, LINES[0]);
  assert(same === story, 'saying a non-once line changes nothing');
});

test('selection is deterministic: same state, same lines, same order', () => {
  const story = setFlag(emptyStory(), 'opening.unfair-rating.cost-paid', true);
  const a = selectDialog(LINES, story).map((line) => line.id).join(',');
  const b = selectDialog(LINES, story).map((line) => line.id).join(',');
  assertEqual(a, b, 'two selections agree exactly');
});

test('dialog sets are validated loud; event gates are an authoring bug', () => {
  assertThrows(() => createDialogSet([{ id: 'x', speaker: '', text: 'hi' }]), 'missing speaker');
  assertThrows(() => createDialogSet([{ id: 'x', speaker: 's', text: '' }]), 'missing text');
  assertThrows(() => createDialogSet([
    { id: 'x', speaker: 's', text: 'hi' },
    { id: 'x', speaker: 's', text: 'again' },
  ]), 'duplicate ids');
  assertThrows(() => createDialogSet([
    { id: 'x', speaker: 's', text: 'hi', requires: [{ kind: 'event', type: 'boom' }] },
  ]), 'event gate rejected — gate on the flag a rule sets');
});

test('a selected line drops onto the V16 clock as a valid dialog cue', () => {
  const line = selectDialog(LINES, emptyStory())[0];
  const scene = GAME_CUTSCENE.create({
    id: 'story-seam',
    duration: 10,
    camera: [{ at: 0, rig: 'Cinematic' }],
    dialog: [asCutsceneCue(line, 2, 3)],
  });
  const frame = GAME_CUTSCENE.sample(scene, 3);
  assertEqual(frame.dialog.length, 1, 'the line is live at t=3');
  assertEqual(frame.dialog[0].speaker, 'dispatcher', 'speaker carries through');
  assertEqual(frame.dialog[0].text, 'You again.', 'text carries through');
});

// ── the door ──────────────────────────────────────────────────────────────────

import { GAME_STORY } from './index';

test('the door is sealed and carries the interface, not a grab-bag', () => {
  assert(Object.isFrozen(GAME_STORY), 'GAME_STORY is frozen');
  assert(!('status' in GAME_STORY), 'no capture-pending claim — the door is live');
  assertEqual(typeof GAME_STORY.setFlag, 'function', 'flags surface');
  assertEqual(typeof GAME_STORY.recordEvent, 'function', 'event log surface');
  assertEqual(typeof GAME_STORY.applyRules, 'function', 'rules surface');
  assertEqual(typeof GAME_STORY.advanceArc, 'function', 'arcs surface');
  assertEqual(typeof GAME_STORY.selectDialog, 'function', 'dialog surface');
  assertEqual(GAME_STORY.openingArc.stages.length, 7, 'the V22 opening rides the door');
  assertEqual(GAME_STORY.rules.length, 2, 'the hmsc story rules ride the door');
  assertEqual(GAME_STORY.tuning.recentEventCap, 240, 'P2 tuning rides the door');
});

finish('game/story');
