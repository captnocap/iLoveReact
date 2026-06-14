// game/missions/defs.ts — the scripted-objective DEFINITION format and the
// mission tables. OBJECTIVE DEFS / SEQUENCES / REWARDS ARE DATA (P2): a
// mission is staged objectives + a reward row + expiry/collateral/binding
// records; every number lives in these tables (authored tables carry their
// own numbers — CaaS rows may not; rows.ts prices those from MISSION_TUNING).
//
// References: cart/scape/design.ts Quest/QuestStage (key/title/giver/stages/
// reward — the reward row is the same shape activities already carried
// verbatim, imported here, never re-declared) + the V22 verdict's row fields
// (client, binding PERSON/POSITION, expiry semantics, collateral policy,
// narrative hooks). scape's Quest was contract-first with no consumer (the
// oracle's hazard); the engine in ./run.ts is built exactly to the ruling and
// these tables.
//
// NARRATIVE HOOKS (V22, the story capture's deferred item closed here): a
// hook is a (text, world_delta) PAIR — "a hook without a delta is the world
// calling the app a liar." defineMission REJECTS empty deltas. The delta is
// uninterpreted data here (the shell/loop applies it, exactly as it owns
// busEmit); when a hook fires, the engine returns it as an event the caller
// records through GAME_STORY's log — the delta's provenance.

import type { ActivityReward, ActivityVerb } from '../activities';
import { GAME_ACTIVITIES } from '../activities';
import type { StoryCondition } from '../story';
import type { MissionObjective } from './objectives';
import { OBJECTIVE_TARGET_KINDS } from './objectives';

/** When a narrative hook plays: at accept, entering a stage, or terminally. */
export type HookAt = 'accept' | `stage:${string}` | 'complete' | 'fail';

export type NarrativeHook = {
  at: HookAt;
  /** the line the app/client shows — launders generator text in-fiction */
  text: string;
  /** what actually changes in the world — REQUIRED and non-empty (V22) */
  worldDelta: Record<string, unknown>;
};

/** V22: contracts declare binding — PERSON (grievance: follows him, voids on
 *  unrelated death) or POSITION (racket: re-arms against the replacement). */
export type MissionBinding =
  | { kind: 'person'; npcId: string }
  | { kind: 'position'; positionId: string };

export type MissionStage = {
  id: string;
  /** one line of player-facing meaning (scape QuestStage.brief) */
  brief: string;
  /** ALL must hold (latched) for the stage to complete */
  objectives: readonly MissionObjective[];
};

export type MissionDef = {
  key: string;
  title: string;
  /** which V22 verb this mission scripts (the same closed, A/B-tested space) */
  verb: ActivityVerb;
  /** who posted it — two-sided missions fall out free (V22) */
  client: string;
  /** contracts bind; jobs (the opening delivery gig) may not */
  binding?: MissionBinding;
  /**
   * THE UNLOCK GATE (the storyline state machine's inbound edges): the mission
   * is only OFFERABLE when every one of these story conditions holds. Predicates
   * as data, the SAME StoryCondition vocabulary arcs and dialog gate on
   * (game/story/conditions.ts) — flag / counter / event. Empty/absent = a root
   * (offerable from the start). A mission `provides` the flags its hooks set
   * (worldDelta.setFlag); B requiring a flag A provides is the edge A→B. This is
   * what the storyline authoring board renders and edits. */
  requires?: readonly StoryCondition[];
  stages: readonly MissionStage[];
  /** scape Quest.reward verbatim (the activities-shared row) */
  reward: ActivityReward;
  /** state ticks until the listing expires (V8 cadence); null = never */
  expiryTicks: number | null;
  /** civilian kills dock the rating by this much each (V22) */
  collateral: { ratingDeltaPerCivilianKill: number };
  hooks: readonly NarrativeHook[];
  /** CaaS provenance — present on row-compiled missions (rows.ts) */
  seed?: string;
  fingerprint?: readonly number[];
};

/** Validate one unlock gate — the same StoryCondition shapes conditions.ts
 *  defines (predicates as data); malformed gates fail at table-build time. */
function validateRequire(where: string, gate: StoryCondition): void {
  switch (gate.kind) {
    case 'flag':
      if (!gate.flag) throw new Error(`${where}: a 'flag' require needs a flag name`);
      return;
    case 'counter':
      if (!gate.counter) throw new Error(`${where}: a 'counter' require needs a counter name`);
      if (!Number.isFinite(gate.atLeast)) throw new Error(`${where}: counter require '${gate.counter}' needs a finite atLeast`);
      return;
    case 'event':
      if (!gate.type) throw new Error(`${where}: an 'event' require needs a type`);
      return;
    default:
      throw new Error(`${where}: unknown require kind ${JSON.stringify((gate as { kind?: unknown }).kind)}`);
  }
}

function validateObjective(where: string, objective: MissionObjective): void {
  const allowed = OBJECTIVE_TARGET_KINDS[objective.kind];
  if (allowed === undefined) throw new Error(`${where}: unknown objective kind ${JSON.stringify(objective.kind)}`);
  if (!objective.brief) throw new Error(`${where}: a ${objective.kind} objective needs a brief`);
  if (allowed === null) {
    if (objective.target) throw new Error(`${where}: '${objective.kind}' takes no target`);
  } else {
    if (!objective.target) throw new Error(`${where}: '${objective.kind}' needs a target (${allowed.join('/')})`);
    if (!allowed.includes(objective.target.kind)) {
      throw new Error(`${where}: '${objective.kind}' cannot target a ${objective.target.kind} (allowed: ${allowed.join('/')})`);
    }
  }
  if (objective.kind === 'earn' || objective.kind === 'evade') {
    if (!(typeof objective.amount === 'number' && Number.isFinite(objective.amount) && objective.amount >= 0)) {
      throw new Error(`${where}: '${objective.kind}' needs a finite amount ≥ 0`);
    }
  }
  if (objective.kind === 'acquire' && !objective.itemKey) {
    throw new Error(`${where}: 'acquire' needs an itemKey`);
  }
}

/**
 * Validate + freeze an authored mission. Fails LOUD at table-build time (the
 * createCutscene discipline — a malformed table is an authoring bug, never a
 * mid-mission surprise). Exported through the door so labs author their own
 * missions against the same boundary.
 */
export function defineMission(def: MissionDef): MissionDef {
  if (!def.key || typeof def.key !== 'string') throw new Error('defineMission: key is required');
  const where = `defineMission("${def.key}")`;
  if (!GAME_ACTIVITIES.isVerb(def.verb)) throw new Error(`${where}: verb ${JSON.stringify(def.verb)} is not in the V22 verb space`);
  if (!def.client) throw new Error(`${where}: a mission needs a client (who posted it)`);
  if (!Array.isArray(def.stages) || def.stages.length < 1) throw new Error(`${where}: at least one stage is required`);
  const stageIds = new Set<string>();
  for (const stage of def.stages) {
    if (!stage.id) throw new Error(`${where}: every stage needs an id`);
    if (stageIds.has(stage.id)) throw new Error(`${where}: duplicate stage id "${stage.id}"`);
    stageIds.add(stage.id);
    if (!Array.isArray(stage.objectives) || stage.objectives.length < 1) {
      throw new Error(`${where}: stage "${stage.id}" needs at least one objective`);
    }
    for (const objective of stage.objectives) {
      validateObjective(`${where} stage "${stage.id}"`, objective);
      Object.freeze(objective);
    }
    Object.freeze(stage.objectives);
    Object.freeze(stage);
  }
  if (def.binding) {
    if (def.binding.kind === 'person' && !def.binding.npcId) throw new Error(`${where}: person binding needs an npcId`);
    if (def.binding.kind === 'position' && !def.binding.positionId) throw new Error(`${where}: position binding needs a positionId`);
    Object.freeze(def.binding);
  }
  for (const gate of def.requires ?? []) {
    validateRequire(where, gate);
    Object.freeze(gate);
  }
  if (def.requires) Object.freeze(def.requires);
  if (def.expiryTicks !== null && !(Number.isInteger(def.expiryTicks) && def.expiryTicks > 0)) {
    throw new Error(`${where}: expiryTicks must be a positive integer or null`);
  }
  if (!(def.collateral && def.collateral.ratingDeltaPerCivilianKill >= 0)) {
    throw new Error(`${where}: collateral.ratingDeltaPerCivilianKill must be ≥ 0`);
  }
  for (const hook of def.hooks) {
    if (!hook.text) throw new Error(`${where}: a narrative hook needs text`);
    if (hook.at !== 'accept' && hook.at !== 'complete' && hook.at !== 'fail') {
      const stageId = hook.at.startsWith('stage:') ? hook.at.slice('stage:'.length) : null;
      if (stageId === null || !stageIds.has(stageId)) {
        throw new Error(`${where}: hook at ${JSON.stringify(hook.at)} names no accept/complete/fail or known stage`);
      }
    }
    if (!hook.worldDelta || Object.keys(hook.worldDelta).length === 0) {
      throw new Error(`${where}: hook "${hook.text}" has no world_delta — a hook without a delta is the world calling the app a liar (V22)`);
    }
    Object.freeze(hook.worldDelta);
    Object.freeze(hook);
  }
  const { cash, repDelta } = def.reward;
  if (cash != null && !(cash >= 0)) throw new Error(`${where}: reward.cash must be ≥ 0`);
  if (repDelta != null && !Number.isFinite(repDelta)) throw new Error(`${where}: reward.repDelta must be finite`);
  Object.freeze(def.stages);
  Object.freeze(def.reward);
  Object.freeze(def.hooks);
  if (def.fingerprint) Object.freeze(def.fingerprint);
  return Object.freeze(def);
}

// ── the tables ────────────────────────────────────────────────────────────────

/**
 * The opening delivery gig — V22 RULED CONTENT: "delivery gig (the tutorial
 * wearing a job costume; the unfair-rating beat MUST cost visible money
 * before the pivot)". A job, not a contract — unbound. The ruled constraint
 * is encoded in the complete-hook's world_delta: the rating is docked
 * unfairly AND the cost is VISIBLE MONEY (cashDelta), and the delta names the
 * arc gate the story capture pinned (opening.unfair-rating.cost-paid) so the
 * shell applying the delta advances OPENING_ARC stage 5. Numbers are this
 * table's own (P2).
 */
const DELIVERY_GIG = defineMission({
  key: 'delivery-gig',
  title: 'Speedy Parcel — first shift',
  verb: 'role',
  client: 'speedy-parcel-app',
  stages: [
    {
      id: 'pickup',
      brief: 'Collect the parcel from the depot',
      objectives: [
        { kind: 'acquire', brief: 'Pick up the parcel', itemKey: 'parcel', marker: { x: 12, z: -4 } },
      ],
    },
    {
      id: 'dropoff',
      brief: 'Deliver it across town',
      objectives: [
        { kind: 'reach', brief: 'Reach the customer', target: { kind: 'point', x: 220, z: 145 } },
      ],
    },
  ],
  reward: { cash: 60 },
  expiryTicks: null,
  collateral: { ratingDeltaPerCivilianKill: 0 },
  hooks: [
    {
      at: 'accept',
      text: 'Welcome to Speedy Parcel! Your rating starts at 5.0 — keep it up!',
      worldDelta: { appInstalled: 'speedy-parcel' },
    },
    {
      at: 'complete',
      text: 'Customer reported: "arrived late, seemed high." Rating adjusted. A service fee applies.',
      worldDelta: { cashDelta: -45, setFlag: 'opening.unfair-rating.cost-paid' },
    },
  ],
});

/** Every shipped authored mission table, by key. */
export const MISSION_DEFINITIONS: Record<string, MissionDef> = Object.freeze({
  [DELIVERY_GIG.key]: DELIVERY_GIG,
});

export function getMissionDefinition(key: string): MissionDef {
  const def = MISSION_DEFINITIONS[key];
  if (!def) throw new Error(`unknown mission "${key}" — shipped tables: ${Object.keys(MISSION_DEFINITIONS).join(', ')}`);
  return def;
}
