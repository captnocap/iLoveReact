// game/perception.ts — GAME_PERCEPTION: the awareness ladder + consequence
// hooks (V12). CAPTURE PENDING.
//
// One detective loop: combat_lab's perception ladder (FoV cones, tile-noise
// hearing, stimulus/lastKnown, upward escalation — the Hitman model) PRODUCES;
// scape's consequence layer (WitnessMemory / the Case) CONSUMES. V21's
// promotion boundary (ambient → identity) hangs off this door too. Door only,
// nothing fake.

export const GAME_PERCEPTION = Object.freeze({
  status: 'capture-pending' as const,
});
