// Behavior tests for the perception system (P4): assert what the detective
// loop DOES — the ladder climbs the ruled rungs, hearing carries the ruled
// distances, hooks fire once per rung, the Case lags truth, the warp lies on
// screen and never in the dice.

import {
  GAME_PERCEPTION,
  PERCEPTION_TUNING,
  awarenessForChance,
  calmPerceiver,
  computeNotoriety,
  emptyCase,
  emptySuspicion,
  footstepNoise,
  gunshotNoise,
  inVisionCone,
  loseTrail,
  makeWitnessMemory,
  matchSignature,
  noiseAudible,
  optimismBias,
  perceivedChance,
  perceptionStep,
  reportToCase,
  suspicionFillPerSecond,
  witnessCertainty,
  type PerceiverState,
  type PerceptionEvent,
  type VisualSignature,
} from './perception';
import { assert, assertClose, assertEqual, finish, test } from './_testkit';

// A police-grade profile (kinds.ts values) used throughout.
const PROFILE = { visionRangeMeters: 24, visionFovDegrees: 120, hearingAcuity: 1.0, reactionSeconds: 0.7 };
const FIGHTER = { profile: PROFILE, canFight: true };
const CIVILIAN = { profile: { ...PROFILE, reactionSeconds: 1.4 }, canFight: false };
const AT = { x: 3, z: -2 };

const seeing = (exposure: number, rangeMeters: number) => ({
  sight: { visible: true, exposure, rangeMeters, position: AT },
  dtSeconds: 0.1,
  nowSeconds: 1,
});
const types = (events: PerceptionEvent[]) => events.map((e) => e.type).join(',');

// ── the ladder ───────────────────────────────────────────────────────────────

test('point-blank in the open is near-instant; a distant crouched glimpse takes seconds', () => {
  const pointBlank = suspicionFillPerSecond(1, 0.5, PROFILE);
  const distantSliver = suspicionFillPerSecond(0.2, 22, PROFILE);
  assert(pointBlank > 1, 'fully exposed point-blank outfills the reaction baseline');
  assert(1 / distantSliver > 5, 'a distant sliver takes many seconds to confirm');
  assert(pointBlank > distantSliver * 5, 'proximity and exposure both matter');
  // reactionSeconds is the kind's baseline: a sharper kind fills faster.
  assert(suspicionFillPerSecond(1, 10, PROFILE) > suspicionFillPerSecond(1, 10, CIVILIAN.profile),
    'police react faster than civilians');
});

test('the ladder climbs the ruled rungs: 0.33 spooks, 0.66 alerts, 1.0 is terminal by kind', () => {
  const T = PERCEPTION_TUNING.ladder;
  assertEqual(T.spookedAt, 0.33, 'spooked threshold');
  assertEqual(T.alertAt, 0.66, 'alert threshold');
  assertEqual(T.confirmedAt, 1.0, 'confirmed threshold');
  let fighter: PerceiverState = { ...calmPerceiver(), suspicion: 0.32 };
  fighter = perceptionStep(fighter, seeing(0.5, 10), FIGHTER).state;
  assertEqual(fighter.mode, 'spooked', 'crossing 0.33 spooks');
  const toTerminal = (ctx: typeof FIGHTER) => {
    let s: PerceiverState = { ...calmPerceiver(), suspicion: 0.999 };
    return perceptionStep(s, { ...seeing(1, 1), dtSeconds: 1 }, ctx).state.mode;
  };
  assertEqual(toTerminal(FIGHTER), 'hostile', 'fighters end hostile');
  assertEqual(toTerminal(CIVILIAN), 'panic', 'the unarmed end in panic');
});

test('one overwhelming stimulus runs the whole ladder in a single step', () => {
  const calm = calmPerceiver();
  const { state, events } = perceptionStep(calm, { ...seeing(1, 0.5), dtSeconds: 3 }, FIGHTER);
  assertEqual(state.mode, 'hostile', 'calm to hostile in one step');
  assertEqual(types(events), 'sightingConfirmed,spooked,alerted,hostile',
    'every rung fires its hook exactly once, in order');
});

test('unattended suspicion bleeds off; a watched pot never cools', () => {
  const T = PERCEPTION_TUNING.ladder;
  const idle = perceptionStep({ ...calmPerceiver(), suspicion: 0.3 },
    { dtSeconds: 1, nowSeconds: 1 }, FIGHTER).state;
  assertClose(idle.suspicion, 0.3 - T.decayPerSecond, 1e-9, 'decay per second');
  const watched = perceptionStep({ ...calmPerceiver(), suspicion: 0.3 },
    seeing(0.5, 23.9), FIGHTER).state;
  assert(watched.suspicion > 0.3, 'any stimulus suspends decay');
});

test('a spooked NPC relaxes only past its dwell AND below the gate', () => {
  const spooked: PerceiverState = {
    mode: 'spooked', suspicion: 0.1, stimulus: AT, lastKnown: null, modeUntilSeconds: 5,
  };
  const early = perceptionStep(spooked, { dtSeconds: 0.1, nowSeconds: 2 }, FIGHTER).state;
  assertEqual(early.mode, 'spooked', 'the freeze holds through the dwell');
  const after = perceptionStep(spooked, { dtSeconds: 0.1, nowSeconds: 6 }, FIGHTER);
  assertEqual(after.state.mode, 'calm', 'past dwell + low suspicion relaxes');
  assertEqual(types(after.events), 'calmed', 'the calm-down is a hook too');
});

test('a glimpse moves the stimulus, never lastKnown; only confirmation sets it', () => {
  const glimpsed = perceptionStep(calmPerceiver(), seeing(0.4, 15), FIGHTER).state;
  assert(glimpsed.stimulus !== null, 'the glimpse is worth investigating');
  assertEqual(glimpsed.lastKnown, null, 'but it is not a confirmed position');
  const confirmed = perceptionStep({ ...calmPerceiver(), suspicion: 0.99 },
    { ...seeing(1, 1), dtSeconds: 1 }, FIGHTER);
  assert(confirmed.state.lastKnown !== null, 'confirmation pins the position');
  assert(confirmed.events.some((e) => e.type === 'sightingConfirmed'), 'and fires the hook');
});

test('gunfire: fighters triangulate and go straight to combat; the unarmed panic', () => {
  const shot = gunshotNoise(AT);
  const cop = perceptionStep(calmPerceiver(), { noises: [shot], dtSeconds: 0.1, nowSeconds: 1 }, FIGHTER);
  assertEqual(cop.state.mode, 'hostile', 'a fighter goes loud off a shot');
  assertEqual(cop.state.lastKnown?.x, AT.x, 'and knows where it came from');
  const civ = perceptionStep(calmPerceiver(), { noises: [shot], dtSeconds: 0.1, nowSeconds: 1 }, CIVILIAN);
  assertEqual(civ.state.mode, 'panic', 'a civilian panics');
  assertEqual(civ.state.lastKnown, null, 'panic is not triangulation');
});

test('a report hands a CONFIRMED position upward (the notify hand-off)', () => {
  const officer = perceptionStep(calmPerceiver(),
    { report: { position: AT }, dtSeconds: 0.1, nowSeconds: 1 }, FIGHTER);
  assertEqual(officer.state.mode, 'hostile', 'the notified officer engages');
  assertEqual(officer.state.lastKnown?.z, AT.z, 'with the reported position');
  assertEqual(officer.state.suspicion, 1, 'a report is total');
});

test('getting shot is total awareness, immediately terminal', () => {
  const hit = perceptionStep(calmPerceiver(),
    { damage: { position: AT }, dtSeconds: 0.016, nowSeconds: 1 }, CIVILIAN);
  assertEqual(hit.state.suspicion, 1, 'no doubt left');
  assertEqual(hit.state.mode, 'panic', 'the unarmed victim panics');
  assert(hit.state.lastKnown !== null, 'the victim knows where it came from');
});

test('losing the trail drops a hostile to a scanning alert, not to calm', () => {
  const hunting: PerceiverState = {
    mode: 'hostile', suspicion: 1, stimulus: AT, lastKnown: AT, modeUntilSeconds: 0,
  };
  const lost = loseTrail(hunting, 10);
  assertEqual(lost.state.mode, 'alert', 'break line of sight and they search');
  assertEqual(lost.state.suspicion, PERCEPTION_TUNING.ladder.lostTrailSuspicion, 'at the tuned suspicion');
  assertEqual(lost.state.lastKnown, null, 'the memory is spent');
  assertEqual(types(lost.events), 'lostTrail', 'the hook fires');
});

// ── the senses ───────────────────────────────────────────────────────────────

test('vision is a forward cone — no eyes in the back of the head', () => {
  const viewer = { position: { x: 0, z: 0 }, headingDegrees: 0 }; // facing +Z
  assert(inVisionCone(viewer, { x: 0, z: 5 }, PROFILE).inCone, 'dead ahead is seen');
  assert(!inVisionCone(viewer, { x: 0, z: -2 }, PROFILE).inCone, 'point-blank BEHIND is invisible');
  assert(!inVisionCone(viewer, { x: 0, z: 25 }, PROFILE).inCone, 'past vision range is invisible');
  assert(inVisionCone(viewer, { x: 5, z: 5 }, PROFILE).inCone, '45° is inside a 120° cone');
  assert(!inVisionCone(viewer, { x: 5, z: -5 }, PROFILE).inCone, '135° is outside it');
});

test('footsteps carry by mode and tile: sneak the mud, not the road', () => {
  const F = PERCEPTION_TUNING.hearing.footsteps;
  assert(F.run.radiusMeters > F.walk.radiusMeters && F.walk.radiusMeters > F.crouch.radiusMeters,
    'run > walk > crouch carry');
  const onRoad = footstepNoise('run', AT, 0.7);
  const inMud = footstepNoise('run', AT, 0.25);
  assertClose(onRoad.radiusMeters, 16 * 0.7, 1e-9, 'the tile scales the carry');
  assert(inMud.radiusMeters < onRoad.radiusMeters, 'mud is the quiet approach');
  // reception: the listener's acuity scales how far a ring reaches THEM
  const listenerAt = (d: number) => ({ x: AT.x + d, z: AT.z });
  assert(noiseAudible(onRoad, listenerAt(11), 1.0), 'sharp ears catch it at 11m');
  assert(!noiseAudible(onRoad, listenerAt(11), 0.8), 'dull ears do not');
});

test('a muzzle blast ignores the tile underfoot and maxes suspicion outright', () => {
  const shot = gunshotNoise(AT);
  assertEqual(shot.radiusMeters, PERCEPTION_TUNING.hearing.gunshot.radiusMeters,
    'gunshot carry is fixed — tile noise does not quiet it');
  assertEqual(shot.salience, 1, 'no half-heard gunshots');
  const step = footstepNoise('walk', AT, 0.7);
  const heard = perceptionStep(calmPerceiver(), { noises: [step], dtSeconds: 0.1, nowSeconds: 1 }, FIGHTER).state;
  assertClose(heard.suspicion, step.salience, 1e-9, 'a footstep bumps by its salience');
});

test('the ladder feeds the chance surface the ruled way (chance item 3 closed)', () => {
  assertEqual(awarenessForChance('calm'), 'unaware', 'the Hitman shot: before they know');
  assertEqual(awarenessForChance('spooked'), 'alert', 'spooked is aware');
  assertEqual(awarenessForChance('alert'), 'alert', 'alert is aware');
  assertEqual(awarenessForChance('hostile'), 'alert', 'a hostile faces you, it does not flee');
  assertEqual(awarenessForChance('panic'), 'fleeing', 'panic runs');
  assertEqual(awarenessForChance('notify'), 'fleeing', 'a notifier runs');
});

// ── the consequence layer ────────────────────────────────────────────────────

test('notoriety is the weighted blend: being SEEN hurts more than funny money', () => {
  const seen = { ...emptySuspicion(), visual: 50 };
  const traced = { ...emptySuspicion(), fund: 50 };
  assert(computeNotoriety(seen) > computeNotoriety(traced), 'visual heat outweighs fund heat');
  assertEqual(computeNotoriety(emptySuspicion()), 0, 'clean slate');
  const maxed = { visual: 100, fund: 100, pattern: 100, digital: 100, location: 100 };
  assertEqual(computeNotoriety(maxed), 100, 'fully burned is 100, never more');
});

test('a witness report reaches the Case exactly once and heats the visual axis only', () => {
  const sig: VisualSignature = { silhouette: 'bulky', color: 'theme:danger', accessory: 'mask' };
  const memory = makeWitnessMemory('murder-1', sig, AT, 1000, 0.8);
  assert(!memory.reported, 'fresh memory is unreported');
  const first = reportToCase(emptyCase(), 'npc-7', memory);
  assert(first.memory.reported, 'reporting marks the memory');
  assertEqual(first.kase.events.join(','), 'murder-1', 'the event joins the file');
  assertClose(first.kase.suspicion.visual, PERCEPTION_TUNING.witness.visualHeatPerReport * 0.8, 1e-9,
    'visual heat by certainty');
  assertEqual(first.kase.suspicion.fund, 0, 'no other axis moves');
  assertEqual(first.kase.topSignature?.accessory, 'mask', 'the description circulates');
  assertEqual(first.kase.leads.length, 1, 'the witness becomes a lead');
  const again = reportToCase(first.kase, 'npc-7', first.memory);
  assertEqual(again.kase, first.kase, 'a reported memory folds nothing twice');
});

test('the Case lags ground truth — it only ever converges by reports', () => {
  const sig: VisualSignature = { silhouette: 'slim', color: 'theme:info', accessory: 'none' };
  let kase = emptyCase();
  for (let i = 0; i < 3; i += 1) {
    kase = reportToCase(kase, `npc-${i}`, makeWitnessMemory(`ev-${i}`, sig, AT, i, 0.5)).kase;
  }
  const truth = { ...emptySuspicion(), visual: 80 };
  assert(kase.suspicion.visual < truth.visual, 'the world believes less than the truth');
  assert(kase.suspicion.visual > 0, 'but it is closing in');
});

test('signature matching: the interrogation question scores 0..1', () => {
  const a: VisualSignature = { silhouette: 'avg', color: 'theme:accent', accessory: 'hood' };
  assertEqual(matchSignature(a, { ...a }), 1, 'the same person');
  assertEqual(matchSignature(a, { silhouette: 'bulky', color: 'theme:muted', accessory: 'bag' }), 0,
    'nothing matches');
  const partial = matchSignature(a, { ...a, accessory: 'none' });
  assert(partial > 0 && partial < 1, 'a costume change fools partially');
});

test('witness certainty: closer and more exposed is more certain (FIRST CUT curve)', () => {
  assert(witnessCertainty(1, 2, 24) > witnessCertainty(1, 20, 24), 'distance erodes certainty');
  assert(witnessCertainty(1, 10, 24) > witnessCertainty(0.3, 10, 24), 'exposure drives it');
  assert(witnessCertainty(1, 0, 24) <= 1 && witnessCertainty(0, 24, 24) >= 0, 'clamped 0..1');
});

// ── the display warp ─────────────────────────────────────────────────────────

test('sober, the UI tells the truth — exactly', () => {
  for (const p of [0, 0.15, 0.5, 0.98]) {
    assertEqual(perceivedChance(p, 0, 12345), p, `pTrue ${p} unchanged sober`);
  }
});

test('the lie ramps with the high: at h≥90 a terrible shot reads comfortable', () => {
  assertEqual(optimismBias(59), 0, 'honest-ish below the tweaking line');
  assert(optimismBias(90) > optimismBias(70), 'manic optimism is quadratic');
  let peak = 0;
  for (let tMs = 0; tMs < 1000; tMs += 25) {
    peak = Math.max(peak, perceivedChance(0.15, 90, tMs));
  }
  assert(peak > 0.5, 'P_true 0.15 reads over 50% at the flicker peak — catastrophic confidence');
});

test('the warp is a pure display read — it owns no dice and no odds', () => {
  assertEqual(perceivedChance(0.4, 80, 333), perceivedChance(0.4, 80, 333), 'same inputs, same lie');
  for (const key of Object.keys(GAME_PERCEPTION)) {
    assert(!/attackChance|rollHit|rollZone/.test(key), `${key} — perception computes no odds`);
  }
});

finish('game/perception');
