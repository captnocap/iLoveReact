// game/missions/ — GAME_MISSIONS: scripted objectives (V22). CAPTURE PENDING.
//
// Built on the cutscene clock, pathing, and the state tick's forced events.
// V22 rules the shape: CaaS dailies are LLM-generated mission ROWS in a closed
// schema (verb set + validated slots), proven against the queryable future,
// played headless by the V19 verify bot before players see them; contracts
// bind PERSON or POSITION. Door only, nothing fake.

export const GAME_MISSIONS = Object.freeze({
  status: 'capture-pending' as const,
});
