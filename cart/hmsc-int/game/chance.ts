// game/chance.ts — GAME_CHANCE: the ONE odds engine (V9). CAPTURE PENDING.
//
// The ruled hybrid: scape's ChanceBreakdown legibility (WHY is it 33%?) +
// hmsc/combat_lab's cover-fraction input, ground-truth-vs-display law intact
// (never compute odds elsewhere; display warp is a separate layer). V9 demands
// a dedicated lab for extensive tuning before this engine is trusted. Door
// only, nothing fake.

export const GAME_CHANCE = Object.freeze({
  status: 'capture-pending' as const,
});
