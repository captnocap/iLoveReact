// game/animation/ — GAME_ANIMATION: the action layer (V6). CAPTURE PENDING.
//
// cart/animationDsl.ts's action vocabulary/alias semantics are the source; the
// bracket-string format is NOT kept — the real representation is RLE'd,
// relational animation data (R6: determinism is fast). Gait stays a pose
// generator under the action layer. Door only, nothing fake.

export const GAME_ANIMATION = Object.freeze({
  status: 'capture-pending' as const,
});
