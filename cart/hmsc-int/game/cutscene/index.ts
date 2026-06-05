// game/cutscene/ — GAME_CUTSCENE: the live scene format (V16). CAPTURE PENDING.
//
// A cutscene is a SIMPLE TYPESCRIPT FILE: one clock driving camera solves,
// DSL timelines, and closed-form motion plans — live, never baked, so the
// player's current state shows. The composition is natively deterministic
// (every track is pure in t). Built as a lab in the rebuilt harness once the
// ground floor carries figure + animation. Door only, nothing fake.

export const GAME_CUTSCENE = Object.freeze({
  status: 'capture-pending' as const,
});
