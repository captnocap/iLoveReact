// Behavior tests for the chance engine (P4): assert what the odds DO — the
// breakdown explains an outcome, cover shifts odds the ruled direction, dice
// are deterministic under a seed — not what the functions are called.

import {
  CHANCE_TUNING,
  COVER_SAMPLE_SPEC,
  GAME_CHANCE,
  attackChance,
  coverFractionFromSamples,
  rollHit,
  rollZone,
  seededRng,
  type AttackInput,
  type RangeProfile,
} from './chance';
import { assert, assertClose, assertEqual, finish, test } from './_testkit';

// A steady mid-day, mid-skill shooter against a standing, alert target —
// the baseline every test perturbs one factor at a time.
const shooter = { skill01: 0.5, health01: 1, hour: 12, awareness: 'alert' as const };
const baseInput: AttackInput = {
  profile: null,
  ranged: true,
  distanceMeters: 3,
  los: 'clear',
  coverFraction: 0,
  shooter,
};
const at = (over: Partial<AttackInput>): AttackInput => ({ ...baseInput, ...over });

const RIFLE: RangeProfile = {
  baseAccuracy: 0.8,
  optimalRange: 12,
  falloffPerMeter: 0.04,
  maxRange: 30,
  glassPenalty: 0.6,
};

// ── the breakdown surface (the scape half of V9) ─────────────────────────────

test('the breakdown EXPLAINS the outcome: final is the clamped product of its own factors', () => {
  const b = attackChance(at({ coverFraction: 0.3, targetCrouched: true, profile: RIFLE, distanceMeters: 9 }));
  const product = b.base * b.range * b.los * b.cover * b.stance * b.awareness * b.health * b.time * b.skill;
  assertClose(b.final, Math.min(Math.max(product, CHANCE_TUNING.finalClamp.min), CHANCE_TUNING.finalClamp.max), 1e-12,
    'final = clamp(product of the named factors) — WHY is it 33% is answerable');
  for (const f of ['base', 'range', 'los', 'cover', 'stance', 'awareness', 'health', 'time', 'skill'] as const) {
    assert(Number.isFinite(b[f]), `${f} factor is a real multiplier`);
  }
});

test('possible shots are never certain and never hopeless; impossible ones are a TRUE 0', () => {
  const sureThing = attackChance(at({ profile: { ...RIFLE, baseAccuracy: 1 }, distanceMeters: RIFLE.optimalRange, shooter: { ...shooter, skill01: 1, awareness: 'unaware' } }));
  assert(sureThing.final <= CHANCE_TUNING.finalClamp.max, 'never quite certain');
  const longShot = attackChance(at({ coverFraction: 0.99, shooter: { ...shooter, skill01: 0 }, distanceMeters: 39 }));
  assert(longShot.final >= CHANCE_TUNING.finalClamp.min, 'never quite hopeless while possible');
  assertEqual(attackChance(at({ los: 'none' })).final, 0, 'no line of sight = no shot, not 2%');
});

// ── the cover input (the hmsc half of V9) ────────────────────────────────────

test('cover shifts odds the ruled direction: continuous, monotone, cuts at most 80%', () => {
  let prev = Infinity;
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    const b = attackChance(at({ coverFraction: f }));
    assert(b.final < prev || (f === 0 && b.final <= prev), `more cover, worse odds (f=${f})`);
    assertClose(b.cover, 1 - f * CHANCE_TUNING.cover.maxCut, 1e-12, `cover factor at f=${f}`);
    prev = b.final;
  }
  const fullCover = attackChance(at({ coverFraction: 1 }));
  assertClose(fullCover.cover, 1 - CHANCE_TUNING.cover.maxCut, 1e-12,
    'full cover cuts 80%, never to zero — cover is not a wall');
  assert(fullCover.final > 0, 'a fully covered target can still be hit');
});

test('coverFraction is a real fraction: half-covered sits strictly between exposed and covered', () => {
  const open = attackChance(at({ coverFraction: 0 })).final;
  const half = attackChance(at({ coverFraction: 0.5 })).final;
  const full = attackChance(at({ coverFraction: 1 })).final;
  assert(full < half && half < open, 'odds order: full < half < exposed');
});

test('the producer fold: coverFraction = blocked/total samples; no samples = exposed', () => {
  assertEqual(coverFractionFromSamples([]), 0, 'no samples, no cover');
  assertEqual(coverFractionFromSamples([{ clear: true }, { clear: true }]), 0, 'all clear');
  assertEqual(coverFractionFromSamples([{ clear: false }, { clear: true }, { clear: false }, { clear: true }]), 0.5, 'half blocked');
  assertEqual(coverFractionFromSamples([{ clear: false }]), 1, 'all blocked');
});

test('the sample spec rides bones, head double-weighted (it peeks over cover)', () => {
  assertEqual(COVER_SAMPLE_SPEC.length, 9, 'nine samples');
  assertEqual(COVER_SAMPLE_SPEC.filter((s) => s.bone === 'head').length, 2, 'head sampled twice');
  for (const s of COVER_SAMPLE_SPEC) assert(typeof s.bone === 'string' && s.bone.length > 0, 'every sample names its bone');
});

test("a tile-level 'partial' LoS prices like the legacy prop cover — and never double-counts", () => {
  const partial = attackChance(at({ los: 'partial' }));
  assertClose(partial.cover, 0.65, 1e-12, 'partial → ×0.65, the scape pricing through the hmsc law');
  assertEqual(partial.los, 1, 'partial contributes through cover, not the los factor');
  const sampled = attackChance(at({ los: 'partial', coverFraction: 0.9 }));
  assertClose(sampled.cover, 1 - 0.9 * CHANCE_TUNING.cover.maxCut, 1e-12,
    'a real sampled fraction wins over the partial floor (max, not sum)');
});

// ── line of sight + range ────────────────────────────────────────────────────

test('glass is a window shot: penalised but possible; the weapon’s own penalty wins', () => {
  const bare = attackChance(at({ los: 'glass' }));
  const clear = attackChance(at({ los: 'clear' }));
  assert(bare.final < clear.final && bare.final > 0, 'glass cuts but does not block');
  assertEqual(bare.los, CHANCE_TUNING.losMult.glass, 'bare attack uses the default glass penalty');
  assertEqual(attackChance(at({ los: 'glass', profile: RIFLE, distanceMeters: 12 })).los, RIFLE.glassPenalty,
    'a profiled weapon prices its own glass');
});

test('a profiled weapon peaks at its optimal range and is unavailable past max', () => {
  const atOptimal = attackChance(at({ profile: RIFLE, distanceMeters: RIFLE.optimalRange }));
  const closer = attackChance(at({ profile: RIFLE, distanceMeters: 4 }));
  const farther = attackChance(at({ profile: RIFLE, distanceMeters: 24 }));
  assertEqual(atOptimal.range, 1, 'full accuracy at optimal range');
  assert(closer.range < 1 && farther.range < 1, 'falloff both directions (the triangle)');
  assert(farther.range >= CHANCE_TUNING.profileRangeFloor, 'inside maxRange never below the floor');
  assertEqual(attackChance(at({ profile: RIFLE, distanceMeters: RIFLE.maxRange + 1 })).final, 0,
    'beyond maxRange the option is unavailable (true 0)');
});

test('a bare ranged attack bleeds on the default curve: full inside 4m, gone by 40m', () => {
  const T = CHANCE_TUNING.defaultRangedFalloff;
  assertEqual(attackChance(at({ distanceMeters: T.fullEffectMeters - 1 })).range, 1, 'full effect point-blank');
  const mid = attackChance(at({ distanceMeters: (T.fullEffectMeters + T.zeroAtMeters) / 2 })).range;
  assert(mid > 0 && mid < 1, 'bleeding at mid range');
  assertEqual(attackChance(at({ distanceMeters: T.zeroAtMeters })).range, 0, 'nothing left at the end');
});

test('melee is adjacency: in reach it ignores sight, dark, and walls do not apply', () => {
  const inReach = attackChance(at({ ranged: false, distanceMeters: 1.5, los: 'glass', shooter: { ...shooter, hour: 23 } }));
  assertEqual(inReach.range, 1, 'adjacent');
  assertEqual(inReach.los, 1, 'melee ignores LoS quality');
  assertEqual(inReach.time, 1, 'melee does not care about the dark');
  assertEqual(attackChance(at({ ranged: false, distanceMeters: 2.5 })).final, 0, 'out of reach is a true 0');
});

// ── shooter & target condition ───────────────────────────────────────────────

test('an unaware mark is a bonus; alert and fleeing targets are harder', () => {
  const T = CHANCE_TUNING.awarenessMult;
  assert(T.unaware > 1 && T.alert < 1 && T.fleeing < T.alert, 'awareness ordering');
  const unaware = attackChance(at({ shooter: { ...shooter, awareness: 'unaware' } })).final;
  const fleeing = attackChance(at({ shooter: { ...shooter, awareness: 'fleeing' } })).final;
  assert(unaware > fleeing, 'the Hitman shot: take it before they know');
});

test('low health means shaky aim; night cuts ranged shots only; skill lifts everything', () => {
  const hurt = attackChance(at({ shooter: { ...shooter, health01: 0.1 } }));
  assert(hurt.final < attackChance(baseInput).final, 'shaky aim');
  const night = attackChance(at({ shooter: { ...shooter, hour: 23 } }));
  assertEqual(night.time, CHANCE_TUNING.night.rangedMult, 'night penalises ranged sight');
  const marksman = attackChance(at({ shooter: { ...shooter, skill01: 1 } }));
  const hopeless = attackChance(at({ shooter: { ...shooter, skill01: 0 } }));
  assert(marksman.final > hopeless.final, 'skill pays');
});

test('a crouched target is harder to hit (the hmsc stance law)', () => {
  const crouched = attackChance(at({ targetCrouched: true }));
  assertEqual(crouched.stance, CHANCE_TUNING.stance.crouchedTargetMult, 'stance factor');
  assert(crouched.final < attackChance(baseInput).final, 'crouching pays');
});

// ── the dice (deterministic under a seed) ────────────────────────────────────

test('same seed, same fight: rolls replay exactly; different seeds diverge', () => {
  const a = seededRng(7);
  const b = seededRng(7);
  const c = seededRng(8);
  const seqA = Array.from({ length: 20 }, () => rollHit(0.5, a));
  const seqB = Array.from({ length: 20 }, () => rollHit(0.5, b));
  const seqC = Array.from({ length: 20 }, () => rollHit(0.5, c));
  assertEqual(seqA.join(','), seqB.join(','), 'identical sequence under one seed');
  assert(seqA.join(',') !== seqC.join(','), 'a different seed is a different fight');
  const zoneRngA = seededRng(42);
  const zoneRngB = seededRng(42);
  const zonesA = Array.from({ length: 10 }, () => rollZone(zoneRngA));
  const zonesB = Array.from({ length: 10 }, () => rollZone(zoneRngB));
  assertEqual(zonesA.join(','), zonesB.join(','), 'zone picks replay under one seed');
});

test('rollHit honors the odds at the boundaries', () => {
  assert(!rollHit(0, () => 0.0001), 'chance 0 never lands');
  assert(rollHit(1, () => 0.9999), 'chance 1 always lands');
  assert(rollHit(0.5, () => 0.49) && !rollHit(0.5, () => 0.51), 'the roll is rng < chance');
});

test('the AI aims center mass: torso dominates the zone table; the table sums sanely', () => {
  const weights = CHANCE_TUNING.zoneWeights;
  const torso = weights.find((w) => w.zone === 'torso')!;
  for (const w of weights) assert(w.weight <= torso.weight, `${w.zone} never outweighs torso`);
  assertClose(weights.reduce((s, w) => s + w.weight, 0), 1, 1e-9, 'weights are a distribution');
  assertEqual(rollZone(() => 0), 'torso', 'low roll strikes center mass');
  assertEqual(rollZone(() => 0.9999), 'head', 'only the tail of the roll finds the head');
});

// ── the door ─────────────────────────────────────────────────────────────────

test('GAME_CHANCE is the one engine: odds, dice, the producer fold, the tuning table', () => {
  assertEqual(typeof GAME_CHANCE.attackChance, 'function', 'attackChance behind the door');
  assertEqual(typeof GAME_CHANCE.rollHit, 'function', 'rollHit behind the door');
  assertEqual(typeof GAME_CHANCE.rollZone, 'function', 'rollZone behind the door');
  assertEqual(typeof GAME_CHANCE.coverFractionFromSamples, 'function', 'the producer fold behind the door');
  assertEqual(GAME_CHANCE.tuning, CHANCE_TUNING, 'the tuning table IS the data (P2)');
  assert(!('status' in GAME_CHANCE), 'the door no longer claims capture-pending');
  // The ground-truth law: nothing here speaks perception's language.
  for (const key of Object.keys(GAME_CHANCE)) {
    assert(!/perceiv|display|warp/i.test(key), `${key} — no display-warp surface in the truth module`);
  }
});

finish('game/chance');
