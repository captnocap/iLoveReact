// game/story/ — GAME_STORY: narrative arcs, dialog, flags (V12/V16/V20/V22).
//
// V12 capture (2026-06-04): the "more internal tooling for story/mission/
// dialog" the verdict orders, rewritten fresh. Feeds and consumes the live
// neighbors strictly through their doors: perception's consequence events
// drive arcs and rules; selected dialog drops onto the cutscene clock.
//
// THE DOCTRINE (V22): the protagonist is EVENT-SOURCED. The story system
// holds NO backstory — every fact is a flag/counter a rule derived from a
// logged event, every arc beat is gated on those facts or on a live
// consequence event, and dialog can only be gated on story state. What the
// world didn't witness, the story cannot know (PROTECT THE ZERO).
//
// PURITY (the perception precedent): nothing here dispatches, subscribes, or
// reads a clock. Every step returns the next state plus the events to record;
// the shell/loop owns the bus and the time. All state is JSON-serializable —
// V20's story stream carries exactly these shapes.
//
//   flags.ts        StoryState {flags, counters} — set/read/bump/revive
//   events.ts       the narrative event log + vocabulary (murder.committed →
//                   the id WitnessMemory/Case reference; deferred from V12's
//                   perception capture)
//   conditions.ts   predicates as data (P2) — flag / counter / event gates
//   rules.ts        event → flag rules (the hmsc story rules), pure
//   arcs.ts         staged progressions + the V22-ruled OPENING_ARC
//   dialog.ts       which lines may be said — selection, once-latch, V16 seam
//   tuning.ts       every knob (P2)

export { STORY_TUNING } from './tuning';

export {
  emptyStory, setFlag, getFlag, flagIsSet, bumpCounter, getCounter, reviveStory,
} from './flags';
export type { StoryState, StoryValue } from './flags';

export {
  createEventLog, recordEvent, findEvent, channelsFor, eventImportance, murderEventInput,
} from './events';
export type {
  MurderDetails, RecordedEvent, StoryEvent, StoryEventInput, StoryEventLog,
  StoryEventRef, StoryEventRefKind,
} from './events';

export { holdsInState, matchesEvent } from './conditions';
export type { StoryCondition } from './conditions';

export { applyRules, STORY_RULES } from './rules';
export type { FlagWrite, RulesResult, StoryRule } from './rules';

export { advanceArc, arcDone, createArc, currentStage, OPENING_ARC, startArc } from './arcs';
export type { ArcAdvanceInput, ArcAdvanceResult, ArcDef, ArcStage, ArcState } from './arcs';

export {
  asCutsceneCue, createDialogSet, dialogAvailable, markSaid, saidFlagKey, selectDialog,
} from './dialog';
export type { DialogEntry } from './dialog';

import { STORY_TUNING } from './tuning';
import { bumpCounter, emptyStory, flagIsSet, getCounter, getFlag, reviveStory, setFlag } from './flags';
import { channelsFor, createEventLog, eventImportance, findEvent, murderEventInput, recordEvent } from './events';
import { holdsInState, matchesEvent } from './conditions';
import { applyRules, STORY_RULES } from './rules';
import { advanceArc, arcDone, createArc, currentStage, OPENING_ARC, startArc } from './arcs';
import { asCutsceneCue, createDialogSet, dialogAvailable, markSaid, selectDialog } from './dialog';

// ── THE DOOR (P3) — game/index.ts re-exports this as-is ─────────────────────

export const GAME_STORY = Object.freeze({
  tuning: STORY_TUNING,

  // flags — the narrative memory
  emptyStory,
  setFlag,
  getFlag,
  flagIsSet,
  bumpCounter,
  getCounter,
  reviveStory,

  // the event log — what the Case references, what arcs/rules consume
  createEventLog,
  recordEvent,
  findEvent,
  channelsFor,
  eventImportance,
  murderEventInput,

  // conditions — predicates as data
  holdsInState,
  matchesEvent,

  // rules — events become flags
  applyRules,
  rules: STORY_RULES,

  // arcs — staged progressions over the log
  createArc,
  startArc,
  advanceArc,
  arcDone,
  currentStage,
  openingArc: OPENING_ARC,

  // dialog — which lines may be said
  createDialogSet,
  selectDialog,
  dialogAvailable,
  markSaid,
  asCutsceneCue,
});
