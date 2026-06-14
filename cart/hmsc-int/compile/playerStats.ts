// compile/playerStats.ts — bake the player-stats config into a flat lump.
//
// GUIDING_LIGHT: store the config, the engine stays dumb. STATS_TUNING (the one
// declarative table the stat formulas read) is flattened to a fixed
// `u32 version | f32[43]` payload so the no-V8 loader seeds the SAME numbers as
// the editor instead of re-declaring constants. The factor tables (pocket-by-
// pants, pack-by-backpack, star thresholds) ride along as fixed-count runs — the
// vocab sizes are fixed, so the whole lump is fixed-layout (mirrors
// PHYSICS_CONFIG). Field order is the contract; the loader twin is
// framework/world/constructor.zig decodeStatsConfig.

import { STATS_TUNING, type PantsId, type BackpackId } from '@game';

export const STATS_CONFIG_LUMP_VERSION = 1;

// Fixed orderings the loader reads positionally. Changing either is a lump
// format change (bump the version + the Zig twin).
const PANTS_ORDER: PantsId[] = ['none', 'briefs', 'shorts', 'jeans', 'slacks', 'skirt', 'cargo'];
const BACKPACK_ORDER: BackpackId[] = ['none', 'satchel', 'backpack', 'suitcase'];
const STAR_THRESHOLD_COUNT = 6;

/** The flat f32 order — keep in lockstep with decodeStatsConfig in Zig and the
 *  STATS_CONFIG doc in runtime/workspace/lumps.ts. */
export function statsConfigFloats(tuning: typeof STATS_TUNING = STATS_TUNING): number[] {
  const t = tuning;
  if (t.wanted.starThresholds.length !== STAR_THRESHOLD_COUNT) {
    throw new Error(`stats config: expected ${STAR_THRESHOLD_COUNT} star thresholds, got ${t.wanted.starThresholds.length}`);
  }
  const floats: number[] = [
    t.health.max,
    t.armor.max,
    t.armor.start,
    t.energy.max,
    t.energy.start,
    t.energy.drainWalkPerSecond,
    t.energy.drainRunPerSecond,
    t.energy.drainJump,
    t.energy.regenPerSecond,
    t.energy.sprintFloor,
    t.wanted.decayPerSecond,
    ...t.wanted.starThresholds,
    t.inventory.handsSlots,
    ...PANTS_ORDER.map((p) => t.inventory.pocketByPants[p]),
    ...BACKPACK_ORDER.map((b) => t.inventory.packByBackpack[b]),
    t.skills.xpBase,
    t.skills.xpCurve,
    t.skills.maxLevel,
    t.skills.effects.stamina.drainReductionAtMax,
    t.skills.effects.stamina.runDurationBonusAtMax,
    t.skills.effects.vehicle.handlingBonusAtMax,
    t.skills.effects.aim.swayReductionAtMax,
    t.skills.effects.aim.recoveryBonusAtMax,
    t.skills.effects.stealth.notorietyGainReductionAtMax,
    t.skills.effects.stealth.decayBonusAtMax,
    t.skills.xpRates.staminaPerStep,
    t.skills.xpRates.vehiclePerMeter,
    t.skills.xpRates.aimPerShot,
    t.skills.xpRates.stealthPerSecondUnseen,
  ];
  return floats;
}

/** The fixed float count the loader asserts (43). */
export const STATS_CONFIG_FLOATS = statsConfigFloats().length;

/** Encode the STATS_CONFIG lump (see runtime/workspace/lumps.ts STATS_CONFIG). */
export function encodeStatsConfigLump(tuning: typeof STATS_TUNING = STATS_TUNING): Uint8Array {
  const floats = statsConfigFloats(tuning);
  const out = new Uint8Array(4 + floats.length * 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, STATS_CONFIG_LUMP_VERSION, true);
  for (let i = 0; i < floats.length; i += 1) view.setFloat32(4 + i * 4, floats[i], true);
  return out;
}
