// game/stats/stats.ts — the player-stats data shape + the FIXED arithmetic.
//
// GUIDING_LIGHT: stats are data; these are the dumb formulas the engine runs
// over them. Two rules hold throughout:
//   • Derived values are NEVER stored — money total, carry capacity and the
//     wanted-star count are computed from factors on demand (factor the product
//     into a sum). Only the irreducible live state is kept.
//   • Progression is ONE uniform skill type (rule-of-two), its level a formula
//     of xp, its effect a lerp of one coefficient. New skill = a new id + its
//     coefficients in STATS_TUNING, never a new code path.
//
// These functions are pure (state, args) → value, so the same arithmetic ports
// to world_loader.zig for the compiled game with no behavioural fork.

import { STATS_TUNING, type BackpackId, type PantsId } from './config';

// ── live state (the irreducible numbers; kept on PlayerState) ─────────────────

/** Money is held as its factors; the total is a SUM, never stored. assets are
 *  references to owned things, each carrying its appraised value. */
export type AssetRef = { id: string; label: string; value: number };
export type Wallet = { cash: number; crypto: number; assets: AssetRef[] };

/** The five gameplay outfit slots. pants/backpack drive carry capacity; the
 *  others are cosmetic here (they bridge to the figure's OutfitDocument). */
export type OutfitLoadout = {
  head: string;
  shirt: string;
  pants: PantsId;
  backpack: BackpackId;
  shoes: string;
};

export type SkillId = 'stamina' | 'vehicle' | 'aim' | 'stealth';
export const SKILL_IDS: SkillId[] = ['stamina', 'vehicle', 'aim', 'stealth'];

/** A gained stat: only xp is stored — level and effect are derived. steps is
 *  the raw odometer the stamina skill earns xp from (walked steps). */
export type SkillState = { xp: number };

/** Everything the stats systems read/write. health/heat/money/inventory already
 *  live on PlayerState as scalars; this is the additive remainder that makes the
 *  full stat set first-class. */
export type PlayerStats = {
  armor: number;
  energy: number;
  wallet: Wallet;
  outfit: OutfitLoadout;
  skills: Record<SkillId, SkillState>;
  /** raw walked-step odometer feeding stamina xp */
  steps: number;
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const lerp = (a: number, b: number, t: number) => a + (b - a) * clamp(t, 0, 1);

export const HEALTH_MAX = STATS_TUNING.health.max;

export function defaultWallet(): Wallet {
  return { cash: 0, crypto: 0, assets: [] };
}

export function defaultOutfitLoadout(): OutfitLoadout {
  return { head: 'none', shirt: 'tee', pants: 'jeans', backpack: 'none', shoes: 'sneakers' };
}

export function defaultSkills(): Record<SkillId, SkillState> {
  return { stamina: { xp: 0 }, vehicle: { xp: 0 }, aim: { xp: 0 }, stealth: { xp: 0 } };
}

export function defaultPlayerStats(): PlayerStats {
  return {
    armor: STATS_TUNING.armor.start,
    energy: STATS_TUNING.energy.start,
    wallet: defaultWallet(),
    outfit: defaultOutfitLoadout(),
    skills: defaultSkills(),
    steps: 0,
  };
}

// ── money: total is a sum of factors ──────────────────────────────────────────

export function assetsValue(wallet: Wallet): number {
  let sum = 0;
  for (const a of wallet.assets) sum += a.value;
  return sum;
}

/** total net worth = cash + crypto + Σ asset appraisals. Never stored. */
export function moneyTotal(wallet: Wallet): number {
  return wallet.cash + wallet.crypto + assetsValue(wallet);
}

// ── carry capacity: a sum of per-slot factors ─────────────────────────────────

export function pocketCapacity(pants: PantsId): number {
  return STATS_TUNING.inventory.pocketByPants[pants] ?? 0;
}

export function packCapacity(backpack: BackpackId): number {
  return STATS_TUNING.inventory.packByBackpack[backpack] ?? 0;
}

/** capacity = hands + pocket(pants) + pack(backpack) — the factored sum. */
export function inventoryCapacity(outfit: OutfitLoadout): number {
  return STATS_TUNING.inventory.handsSlots + pocketCapacity(outfit.pants) + packCapacity(outfit.backpack);
}

export function inventoryIsFull(itemCount: number, outfit: OutfitLoadout): boolean {
  return itemCount >= inventoryCapacity(outfit);
}

// ── wanted: a quantization of notoriety (0..100) ──────────────────────────────

/** number of lit stars (0..6) for a notoriety value. */
export function wantedStars(notoriety: number): number {
  const thresholds = STATS_TUNING.wanted.starThresholds;
  let stars = 0;
  for (const t of thresholds) if (notoriety >= t) stars += 1;
  return stars;
}

export const MAX_WANTED_STARS = STATS_TUNING.wanted.starThresholds.length;

/** Notoriety bleed while evading (no fresh heat). The stealth skill speeds it. */
export function decayNotoriety(notoriety: number, dtSeconds: number, stealthLevel: number): number {
  const bonus = lerp(0, STATS_TUNING.skills.effects.stealth.decayBonusAtMax, skillFraction(stealthLevel));
  const rate = STATS_TUNING.wanted.decayPerSecond * (1 + bonus);
  return Math.max(0, notoriety - rate * dtSeconds);
}

// ── skills: one xp→level curve, one effect lerp ───────────────────────────────

export const MAX_SKILL_LEVEL = STATS_TUNING.skills.maxLevel;

/** level = min(maxLevel, floor((xp / xpBase) ^ xpCurve)). */
export function skillLevel(xp: number): number {
  if (xp <= 0) return 0;
  const raw = Math.floor(Math.pow(xp / STATS_TUNING.skills.xpBase, STATS_TUNING.skills.xpCurve));
  return clamp(raw, 0, MAX_SKILL_LEVEL);
}

/** xp needed to first reach a level — the curve inverted (for HUD progress). */
export function xpForLevel(level: number): number {
  if (level <= 0) return 0;
  return STATS_TUNING.skills.xpBase * Math.pow(level, 1 / STATS_TUNING.skills.xpCurve);
}

/** 0..1 progress from the current level toward the next (for a progress bar). */
export function skillProgress(xp: number): number {
  const level = skillLevel(xp);
  if (level >= MAX_SKILL_LEVEL) return 1;
  const floor = xpForLevel(level);
  const ceil = xpForLevel(level + 1);
  return ceil > floor ? clamp((xp - floor) / (ceil - floor), 0, 1) : 0;
}

/** normalized skill strength 0..1 (level / maxLevel) — the lerp parameter. */
export function skillFraction(level: number): number {
  return clamp(level / MAX_SKILL_LEVEL, 0, 1);
}

// ── energy: drain by activity ÷ stamina, regen at rest ────────────────────────

export type EnergyActivity = 'rest' | 'walk' | 'run';

export const ENERGY_MAX = STATS_TUNING.energy.max;

function staminaDrainScale(staminaLevel: number): number {
  const reduction = lerp(0, STATS_TUNING.skills.effects.stamina.drainReductionAtMax, skillFraction(staminaLevel));
  return 1 - reduction;
}

/** advance energy one frame for a continuous activity. */
export function stepEnergy(energy: number, activity: EnergyActivity, dtSeconds: number, staminaLevel: number): number {
  const e = STATS_TUNING.energy;
  let next = energy;
  if (activity === 'rest' || activity === 'walk') {
    const drain = activity === 'walk' ? e.drainWalkPerSecond : 0;
    next = next - drain * staminaDrainScale(staminaLevel) * dtSeconds + e.regenPerSecond * (activity === 'rest' ? 1 : 0) * dtSeconds;
  } else {
    next = next - e.drainRunPerSecond * staminaDrainScale(staminaLevel) * dtSeconds;
  }
  return clamp(next, 0, e.max);
}

/** one-shot energy cost of a jump. */
export function jumpEnergyCost(staminaLevel: number): number {
  return STATS_TUNING.energy.drainJump * staminaDrainScale(staminaLevel);
}

export function canSprint(energy: number): boolean {
  return energy > STATS_TUNING.energy.sprintFloor;
}

// ── xp gain: events → xp (the gained-stat earn rates) ─────────────────────────

/** Add steps to the odometer and the matching stamina xp. Returns the patched
 *  stat fragment (caller folds it back). */
export function earnStepsXp(stats: PlayerStats, steps: number): { steps: number; stamina: SkillState } {
  const xp = stats.skills.stamina.xp + steps * STATS_TUNING.skills.xpRates.staminaPerStep;
  return { steps: stats.steps + steps, stamina: { xp } };
}

export function vehicleXpForDistance(meters: number): number {
  return meters * STATS_TUNING.skills.xpRates.vehiclePerMeter;
}
export function aimXpForShots(shots: number): number {
  return shots * STATS_TUNING.skills.xpRates.aimPerShot;
}
export function stealthXpForUnseen(seconds: number): number {
  return seconds * STATS_TUNING.skills.xpRates.stealthPerSecondUnseen;
}

// ── skill effects (the factors other systems multiply by) ─────────────────────

/** handling multiplier GAME_DRIVING grip/steer scale by (1 + this). */
export function vehicleHandlingBonus(level: number): number {
  return lerp(0, STATS_TUNING.skills.effects.vehicle.handlingBonusAtMax, skillFraction(level));
}
/** aim sway is multiplied by (1 - this). */
export function aimSwayReduction(level: number): number {
  return lerp(0, STATS_TUNING.skills.effects.aim.swayReductionAtMax, skillFraction(level));
}
export function aimRecoveryBonus(level: number): number {
  return lerp(0, STATS_TUNING.skills.effects.aim.recoveryBonusAtMax, skillFraction(level));
}
/** fresh notoriety gain is multiplied by (1 - this). */
export function stealthGainReduction(level: number): number {
  return lerp(0, STATS_TUNING.skills.effects.stealth.notorietyGainReductionAtMax, skillFraction(level));
}
