// game/story/ — GAME_STORY: narrative arcs, dialog, flags (V12/V22). CAPTURE
// PENDING.
//
// Feeds/consumes perception consequences and cutscenes. V22 rules the doctrine
// it grows into: the protagonist is event-sourced (no backstory; PROTECT THE
// ZERO), relationships accumulate only from witnessed in-log events. More
// internal tooling is still needed for story/mission/dialog (V12). Door only,
// nothing fake.

export const GAME_STORY = Object.freeze({
  status: 'capture-pending' as const,
});
