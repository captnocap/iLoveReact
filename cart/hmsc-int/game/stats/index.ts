// game/stats/index.ts — GAME_STATS: the player-stats ground floor (one door).
//
// The canonical player-stats model: core stats (health/armor/energy/money/
// wanted/inventory/outfit) and gained stats (the uniform skill: stamina,
// vehicle, aim, stealth). Everything derived is a formula over STATS_TUNING;
// nothing is a stored product. Labs and the HUD import this door ONLY (V17).

import { STATS_TUNING, type PantsId, type BackpackId } from './config';
import * as S from './stats';
import { wantedFromNotoriety, loadoutFromDocument, documentFromLoadout } from './bridges';

export const GAME_STATS = {
  /** the tunable config table (P2; baked into the STATS_CONFIG lump) */
  tuning: STATS_TUNING,

  // defaults
  defaultPlayerStats: S.defaultPlayerStats,
  defaultWallet: S.defaultWallet,
  defaultOutfit: S.defaultOutfitLoadout,
  defaultSkills: S.defaultSkills,

  // money (factored sum)
  moneyTotal: S.moneyTotal,
  assetsValue: S.assetsValue,

  // carry capacity (factored sum)
  inventoryCapacity: S.inventoryCapacity,
  inventoryIsFull: S.inventoryIsFull,
  pocketCapacity: S.pocketCapacity,
  packCapacity: S.packCapacity,

  // wanted
  wantedStars: S.wantedStars,
  wantedFromNotoriety,
  decayNotoriety: S.decayNotoriety,
  maxWantedStars: S.MAX_WANTED_STARS,

  // energy
  stepEnergy: S.stepEnergy,
  jumpEnergyCost: S.jumpEnergyCost,
  canSprint: S.canSprint,

  // skills (one curve, one effect lerp)
  skillIds: S.SKILL_IDS,
  skillLevel: S.skillLevel,
  xpForLevel: S.xpForLevel,
  skillProgress: S.skillProgress,
  skillFraction: S.skillFraction,
  maxSkillLevel: S.MAX_SKILL_LEVEL,

  // skill effects (factors)
  vehicleHandlingBonus: S.vehicleHandlingBonus,
  aimSwayReduction: S.aimSwayReduction,
  aimRecoveryBonus: S.aimRecoveryBonus,
  stealthGainReduction: S.stealthGainReduction,

  // xp earn (events → xp)
  earnStepsXp: S.earnStepsXp,
  vehicleXpForDistance: S.vehicleXpForDistance,
  aimXpForShots: S.aimXpForShots,
  stealthXpForUnseen: S.stealthXpForUnseen,

  // figure outfit bridge
  loadoutFromDocument,
  documentFromLoadout,

  // constants
  healthMax: S.HEALTH_MAX,
  energyMax: S.ENERGY_MAX,
} as const;

export { STATS_TUNING } from './config';
export type { PantsId, BackpackId } from './config';
export type {
  PlayerStats, Wallet, AssetRef, OutfitLoadout, SkillId, SkillState, EnergyActivity,
} from './stats';
