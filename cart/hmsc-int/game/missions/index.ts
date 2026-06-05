// game/missions/ — GAME_MISSIONS: scripted objectives (V22/V8/V16/V20).
//
// Built on the cutscene clock, pathing, and the state tick's forced events
// (STRUCTURE's words). V22 rules the shape: CaaS dailies are LLM-generated
// mission ROWS in a closed schema, the validator proves every slot against
// the queryable future, the LLM never touches numbers (tuning prices the
// gig), narrative hooks are (text, world_delta) pairs recorded through
// GAME_STORY's log, and contracts bind PERSON or POSITION. Missions are the
// SCRIPTED counterpart of activities — the side-loop engine completes on
// reported signals; this one completes by world-query. THE ONE DOOR (P3)
// over:
//
//   tuning.ts      every knob + the gig pricer (P2) — rows carry no numbers
//   objectives.ts  the completion-predicate vocabulary (scape's Objective
//                  reference) evaluated against the queryable world AS DATA
//   defs.ts        mission tables: staged objectives / hooks / rewards (P2);
//                  the V22-ruled opening delivery gig ships here
//   rows.ts        the CaaS closed row schema: validator (queryable future),
//                  dedup window (seed + embedding fingerprint), row → priced
//                  MissionDef
//   run.ts         the pure engine: accept → step-per-tick (forced tick =
//                  same call now) → complete/pay what the table says;
//                  failure degrades, never ends; voided = the one fail screen
//   stream.ts      the V20 'missions' concern — completion/rating tallies
//                  per verb (tomorrow's generation weights' input)
//
// PURITY (the perception precedent): nothing here dispatches, paths, or
// samples a clock. The seams below RETURN the neighbor systems' own inputs —
// the shell/loop owns busEmit, GAME_PATHING owns motion, GAME_CUTSCENE owns
// the one clock.

import { stateTickIntervalMs } from '../loop';
import type { CutsceneDef, CutsceneDialogCue } from '../cutscene';
import type { StoryEventInput } from '../story';
import { MISSION_TUNING } from './tuning';
import {
  evaluateObjective, objectiveMarker, OBJECTIVE_TARGET_KINDS, resolveTargetNpc,
} from './objectives';
import type { MissionFacts, MissionObjective, ObjectiveKind, ObjectiveTarget } from './objectives';
import { defineMission, getMissionDefinition, MISSION_DEFINITIONS } from './defs';
import type { HookAt, MissionBinding, MissionDef, MissionStage, NarrativeHook } from './defs';
import {
  fingerprintSimilarity, isDuplicateRow, missionFromRow, ROW_STAGE_ID, validateRow,
} from './rows';
import type { MissionAffordances, MissionRow, RowObjective, RowVerdict } from './rows';
import { acceptMission, payoutCash, rearmMission, restartMission, stepMission } from './run';
import type { MissionEvent, MissionRun, MissionStatus, MissionStepResult, MissionTickInput } from './run';
import { missionsStream } from './stream';

export { MISSION_TUNING } from './tuning';
export {
  evaluateObjective, objectiveMarker, OBJECTIVE_TARGET_KINDS, resolveTargetNpc,
} from './objectives';
export type { MissionFacts, MissionObjective, ObjectiveKind, ObjectiveTarget } from './objectives';
export { defineMission, getMissionDefinition, MISSION_DEFINITIONS } from './defs';
export type { HookAt, MissionBinding, MissionDef, MissionStage, NarrativeHook } from './defs';
export {
  fingerprintSimilarity, isDuplicateRow, missionFromRow, ROW_STAGE_ID, validateRow,
} from './rows';
export type { MissionAffordances, MissionRow, RowObjective, RowVerdict } from './rows';
export { acceptMission, payoutCash, rearmMission, restartMission, stepMission } from './run';
export type { MissionEvent, MissionRun, MissionStatus, MissionStepResult, MissionTickInput } from './run';
export { missionsStream } from './stream';
export type { MissionsStreamState, MissionVerbOutcomes } from './stream';

/**
 * How long this mission's listing lasts in wall milliseconds — the table
 * speaks state ticks, GAME_LOOP owns the ruled cadence, this is the one
 * conversion (the activities stageDurationMs idiom). Never-expiring: null.
 */
export function expiryDurationMs(def: MissionDef): number | null {
  if (def.expiryTicks === null) return null;
  return def.expiryTicks * stateTickIntervalMs();
}

/**
 * THE STORY-LOG SEAM (the story capture's deferred item closed): map an
 * engine event onto GAME_STORY's event-input shape — the caller records it
 * with GAME_STORY.recordEvent, and a fired hook's world_delta rides the
 * payload, giving the delta the log's provenance (V22: "a hook without a
 * delta is the world calling the app a liar" — here is where the delta
 * becomes a witnessed fact). occurredAt is the caller's (the log is a pure
 * function of what it is told).
 */
export function asStoryEventInput(event: MissionEvent, occurredAt: string): StoryEventInput {
  const { kind, defKey, ...payload } = event;
  return {
    type: `mission.${kind}`,
    source: 'game.missions',
    occurredAt,
    subject: { kind: 'story', id: defKey },
    tags: ['mission'],
    payload: { ...payload },
  };
}

/**
 * THE V16 SEAM: the mission briefing as a cutscene def on the one clock —
 * each accept-hook line spoken by the client (the head_lab talking face),
 * sequential at tuning.briefing.lineSeconds, under the tuning rig. The
 * caller hands this to GAME_CUTSCENE.create and drives the clock; nothing
 * here samples time. Missions with no accept hooks have no briefing: null.
 */
export function briefingCutscene(def: MissionDef): CutsceneDef | null {
  const lines = def.hooks.filter((hook) => hook.at === 'accept');
  if (lines.length === 0) return null;
  const lineSeconds = MISSION_TUNING.briefing.lineSeconds;
  const dialog: CutsceneDialogCue[] = lines.map((hook, i) => ({
    at: i * lineSeconds,
    duration: lineSeconds,
    speaker: def.client,
    text: hook.text,
  }));
  return {
    id: `briefing:${def.key}`,
    duration: lines.length * lineSeconds,
    camera: [{ at: 0, rig: MISSION_TUNING.briefing.rig }],
    dialog,
  };
}

// ── THE DOOR (P3) — game/index.ts re-exports this as-is ─────────────────────

export const GAME_MISSIONS = Object.freeze({
  tuning: MISSION_TUNING,

  // objectives — the completion-predicate vocabulary (world-query as data)
  evaluateObjective,
  objectiveMarker,
  resolveTargetNpc,
  TARGET_KINDS: OBJECTIVE_TARGET_KINDS,

  // the tables (P2) + the authoring boundary labs use
  DEFINITIONS: MISSION_DEFINITIONS,
  get: getMissionDefinition,
  define: defineMission,

  // the CaaS row pipeline: closed schema → queryable-future proof → priced def
  validateRow,
  missionFromRow,
  isDuplicateRow,
  fingerprintSimilarity,
  ROW_STAGE_ID,

  // the engine (pure; one call = one state tick; forced tick = same call now)
  accept: acceptMission,
  step: stepMission,
  restart: restartMission,
  rearm: rearmMission,
  payoutCash,
  expiryDurationMs,

  // the seams (returned, never dispatched)
  asStoryEventInput,
  briefingCutscene,

  // the V20 concern (hand to store.defineStream)
  stream: missionsStream,
});
