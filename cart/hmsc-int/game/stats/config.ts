// game/stats/config.ts — STATS_TUNING: the player-stats config, as DATA.
//
// GUIDING_LIGHT: a game is data. Every number a stat formula reads lives here in
// ONE flat, declarative table — defaults, maxes, drain rates, the xp curve, the
// per-skill effect coefficients, and the FACTOR tables (pocket-by-pants,
// pack-by-backpack, star thresholds). The formulas in stats.ts are fixed
// arithmetic over this table; nothing about player progression is hardcoded in a
// system. This is also exactly what compile/playerStats.ts bakes into the
// STATS_CONFIG lump so the no-V8 loader seeds the same numbers — the config
// carries end to end, the engine stays dumb.
//
// P2 (SETTINGS-0605): the scalar knobs register with editorTunables so /settings
// edits them live. The factor TABLES (string-keyed maps, arrays) are data, not
// knobs — they flatten into the lump but aren't slider leaves.

import { editorTunables } from '../../editors/tunables';

/** Gameplay outfit slots — the five the player dresses (R: pants/backpack
 *  dictate carry capacity). Distinct from the figure's OutfitDocument render
 *  vocab; bridged in bridges.ts. */
export type PantsId = 'none' | 'briefs' | 'shorts' | 'jeans' | 'slacks' | 'skirt' | 'cargo';
export type BackpackId = 'none' | 'satchel' | 'backpack' | 'suitcase';

export const STATS_TUNING = {
  health: { max: 100 },
  // Armor soaks damage before health; starts empty, tops at 100.
  armor: { max: 100, start: 0 },
  // Energy is the run/jump budget. It drains by activity and regens at rest;
  // the stamina skill divides the drain (see stats.ts).
  energy: {
    max: 100,
    start: 100,
    drainWalkPerSecond: 0.4,
    drainRunPerSecond: 6.0,
    drainJump: 7.0, // one-shot cost charged on a jump
    regenPerSecond: 5.0, // recovered per second while resting
    sprintFloor: 5, // below this you cannot start a sprint
  },
  // Wanted is a 6-star quantization of notoriety (0..100), which is bridged from
  // the live heat scalar / GAME_PERCEPTION. Persistent: notoriety only bleeds
  // off while evading (no fresh heat), at decayPerSecond — the stealth skill
  // speeds that (drop the wanted level easier).
  wanted: {
    // star N lights once notoriety reaches starThresholds[N-1]; six entries.
    starThresholds: [8, 20, 35, 52, 72, 90] as number[],
    decayPerSecond: 0.5,
  },
  // Carry capacity is a SUM of per-slot factors, never a pants×backpack product
  // (GUIDING_LIGHT: factor the product into a sum). Each garment contributes a
  // slot factor; capacity = hands + pocket(pants) + pack(backpack).
  inventory: {
    handsSlots: 1,
    pocketByPants: { none: 0, briefs: 0, shorts: 2, jeans: 4, slacks: 4, skirt: 1, cargo: 8 } as Record<PantsId, number>,
    packByBackpack: { none: 0, satchel: 4, backpack: 8, suitcase: 14 } as Record<BackpackId, number>,
  },
  // ONE xp→level curve, shared by every skill (rule-of-two: no per-skill copy).
  // level = min(maxLevel, floor((xp / xpBase) ^ xpCurve)). Each skill's effect
  // lerps its coefficient by level/maxLevel; xp arrives as events (steps walked,
  // metres driven, shots fired, seconds unseen) at the per-event rates below.
  skills: {
    xpBase: 100,
    xpCurve: 0.7,
    maxLevel: 10,
    effects: {
      // stamina: less energy drain, longer sprints.
      stamina: { drainReductionAtMax: 0.5, runDurationBonusAtMax: 1.0 },
      // vehicle: tighter handling (multiplies GAME_DRIVING grip/steer feel).
      vehicle: { handlingBonusAtMax: 0.4 },
      // aim: less sway, faster recovery.
      aim: { swayReductionAtMax: 0.6, recoveryBonusAtMax: 0.5 },
      // stealth: gain notoriety slower, shed it faster.
      stealth: { notorietyGainReductionAtMax: 0.5, decayBonusAtMax: 1.0 },
    },
    xpRates: {
      staminaPerStep: 0.02,
      vehiclePerMeter: 0.01,
      aimPerShot: 0.5,
      stealthPerSecondUnseen: 0.05,
    },
  },
} as const;

// ── P2 registry (SETTINGS-0605): the scalar knobs, /settings-editable ─────────
editorTunables().register({
  system: 'player-stats',
  route: 'game/stats',
  table: STATS_TUNING,
  specs: {
    'energy.max': { label: 'energy max', min: 1, max: 1000, step: 1, precision: 0 },
    'energy.drainWalkPerSecond': { label: 'walk drain', min: 0, max: 20, step: 0.1, precision: 2 },
    'energy.drainRunPerSecond': { label: 'run drain', min: 0, max: 40, step: 0.1, precision: 2 },
    'energy.drainJump': { label: 'jump drain', min: 0, max: 50, step: 0.5, precision: 1 },
    'energy.regenPerSecond': { label: 'energy regen', min: 0, max: 40, step: 0.1, precision: 2 },
    'energy.sprintFloor': { label: 'sprint floor', min: 0, max: 100, step: 1, precision: 0 },
    'armor.max': { label: 'armor max', min: 1, max: 1000, step: 1, precision: 0 },
    'wanted.decayPerSecond': { label: 'wanted decay', min: 0, max: 20, step: 0.1, precision: 2 },
    'inventory.handsSlots': { label: 'hands slots', min: 0, max: 8, step: 1, precision: 0 },
    'skills.xpBase': { label: 'xp base', min: 1, max: 10000, step: 1, precision: 0 },
    'skills.xpCurve': { label: 'xp curve', min: 0.1, max: 2, step: 0.05, precision: 2 },
    'skills.maxLevel': { label: 'max level', min: 1, max: 100, step: 1, precision: 0 },
  },
});
