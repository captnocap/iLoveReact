// Behavior tests for GAME_STATS (P4): assert what the stat formulas DO —
// derived values are sums of factors, the wanted quantizer steps at thresholds,
// the skill curve and energy drain behave — not what the functions are called.

import {
  moneyTotal, assetsValue, inventoryCapacity, wantedStars, decayNotoriety,
  skillLevel, xpForLevel, skillProgress, stepEnergy, jumpEnergyCost, canSprint,
  earnStepsXp, defaultPlayerStats, MAX_WANTED_STARS, MAX_SKILL_LEVEL,
  type Wallet, type OutfitLoadout,
} from './stats';
import { wantedFromNotoriety } from './bridges';
import { STATS_TUNING } from './config';
import { assert, assertClose, assertEqual, finish, test } from '../_testkit';

const wallet = (over: Partial<Wallet> = {}): Wallet => ({ cash: 0, crypto: 0, assets: [], ...over });
const outfit = (over: Partial<OutfitLoadout> = {}): OutfitLoadout => ({ ...defaultPlayerStats().outfit, ...over });

test('money total is the sum of cash, crypto and appraised assets', () => {
  const w = wallet({ cash: 100, crypto: 50, assets: [{ id: 'car', label: 'car', value: 9000 }, { id: 'gun', label: 'gun', value: 300 }] });
  assertEqual(assetsValue(w), 9300, 'assets sum');
  assertEqual(moneyTotal(w), 9450, 'total = cash + crypto + assets');
});

test('carry capacity is hands + pocket(pants) + pack(backpack), a sum not a product', () => {
  const hands = STATS_TUNING.inventory.handsSlots;
  assertEqual(inventoryCapacity(outfit({ pants: 'none', backpack: 'none' })), hands, 'bare = hands only');
  assertEqual(inventoryCapacity(outfit({ pants: 'jeans', backpack: 'none' })), hands + 4, 'jeans add pockets');
  assertEqual(inventoryCapacity(outfit({ pants: 'cargo', backpack: 'suitcase' })), hands + 8 + 14, 'factors add');
});

test('wanted lights stars at the notoriety thresholds, capped at six', () => {
  assertEqual(wantedStars(0), 0, 'clean = no stars');
  assertEqual(wantedStars(8), 1, 'first threshold lights one star');
  assertEqual(wantedStars(100), MAX_WANTED_STARS, 'maxed notoriety = full stars');
  assertEqual(wantedFromNotoriety(35), 3, 'bridge quantizes the same way');
});

test('notoriety bleeds while evading and the stealth skill speeds it', () => {
  const slow = decayNotoriety(50, 1, 0);
  const fast = decayNotoriety(50, 1, MAX_SKILL_LEVEL);
  assert(slow < 50, 'notoriety decays');
  assert(fast < slow, 'stealth shed is faster');
  assertEqual(decayNotoriety(0.1, 10, 0), 0, 'never below zero');
});

test('skill level follows the shared xp curve and progress is 0..1', () => {
  assertEqual(skillLevel(0), 0, 'no xp = level 0');
  assert(skillLevel(xpForLevel(3)) >= 3, 'xpForLevel reaches its level');
  assert(skillLevel(1e9) === MAX_SKILL_LEVEL, 'level caps at max');
  const p = skillProgress(xpForLevel(2) + 1);
  assert(p >= 0 && p <= 1, 'progress is a fraction');
});

test('energy drains running, regens at rest, and stamina reduces the drain', () => {
  const ran = stepEnergy(100, 'run', 1, 0);
  const ranFit = stepEnergy(100, 'run', 1, MAX_SKILL_LEVEL);
  assert(ran < 100, 'running drains');
  assert(ranFit > ran, 'stamina reduces drain');
  assert(stepEnergy(50, 'rest', 1, 0) > 50, 'rest regenerates');
  assertEqual(stepEnergy(0.1, 'run', 100, 0), 0, 'never below zero');
  assert(jumpEnergyCost(0) > jumpEnergyCost(MAX_SKILL_LEVEL), 'a fit jump costs less');
  assert(!canSprint(STATS_TUNING.energy.sprintFloor), 'cannot sprint at the floor');
});

test('walked steps earn stamina xp and advance the odometer', () => {
  const stats = defaultPlayerStats();
  const earned = earnStepsXp(stats, 500);
  assertEqual(earned.steps, 500, 'odometer advances');
  assertClose(earned.stamina.xp, 500 * STATS_TUNING.skills.xpRates.staminaPerStep, 1e-9, 'xp by the rate');
});

finish('stats');
