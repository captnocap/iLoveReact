// game/story/tuning.ts — every story knob is data (P2: no private constants).
//
// Values captured from the hmsc reference: the 240-event recent ring
// (state/defaults.ts DEFAULT_GAME_EVENT_LOG_LIMIT), the `hmsc` channel/id
// prefixes, and the gameEvents.ts importance constants.

export const STORY_TUNING = Object.freeze({
  /** how many events the in-state ring keeps (the full log is V20's stream) */
  recentEventCap: 240,
  /** event id prefix → `hmsc_evt_000001` (what the Case references) */
  eventIdPrefix: 'hmsc_evt',
  /** bus channel prefix → `hmsc:event`, `hmsc:tag:<tag>`, ... */
  channelPrefix: 'hmsc',
  /** host-bus importance by event-type family (gameEvents.ts constants) */
  importance: Object.freeze({
    story: 0.78,
    trigger: 0.72,
    command: 0.35,
    default: 0.5,
  }),
});
