// game/missions/run.ts — the mission ENGINE: a pure, deterministic state
// machine over (run, definition, tick input). Built on the state tick's
// forced events (V8): one call = ONE state tick at the ~45/min reconciliation
// cadence; a player action's forced tick is the SAME function called now with
// fresh facts. The engine never owns a timer or queries the world — the
// queryable world arrives as the tick's MissionFacts snapshot (the activities
// capture's deferral closed: completion-by-world-query lives here).
//
// Determinism is R6's gameplay-wide value: no randomness, no clock reads —
// the same definition fed the same tick inputs yields byte-identical runs and
// events. Events are INERT-BY-EXPLICIT-DESIGN (the perception precedent);
// ./index.ts maps them onto GAME_STORY's log (asStoryEventInput) and nothing
// here dispatches.
//
// THE V22 TERMINAL LAW: failure degrades, never ends — failed (expired)
// missions restart; position-bound contracts re-arm against the replacement
// (diegetic replay: posts refill, contracts re-list). 'voided' is the ONE
// impossible-predicate terminal (a person-bound contract whose person died an
// UNRELATED death — the grievance follows him, and he's gone): it never
// revives. Fail screens only for impossible predicates.

import type { HookAt, MissionDef, MissionStage, NarrativeHook } from './defs';
import type { MissionFacts } from './objectives';
import { evaluateObjective, resolveTargetNpc } from './objectives';
import { MISSION_TUNING } from './tuning';

export type MissionStatus = 'active' | 'completed' | 'failed' | 'voided';

export type MissionRun = {
  defKey: string;
  status: MissionStatus;
  /** index into definition.stages while active */
  stageIndex: number;
  /** latched per-objective completion for the CURRENT stage */
  objectiveDone: boolean[];
  /** state ticks since accept — expiry counts these */
  ticksActive: number;
  /** the CaaS rating for this listing; collateral docks it (V22) */
  rating: number;
  civilianKills: number;
  /** position-bound runs: the npc currently occupying the post (re-arms swap it) */
  occupantId: string | null;
  /** cash actually paid across the listing's whole life (re-arms accumulate) */
  totalCashPaid: number;
};

/** What the world reports for this tick. Everything optional — a bare tick
 *  (no news) still counts toward expiry. */
export type MissionTickInput = {
  facts?: MissionFacts;
  /** civilians killed THIS tick — the collateral policy docks the rating */
  civilianKills?: number;
};

export type MissionEvent =
  | { kind: 'accepted'; defKey: string }
  | { kind: 'hookFired'; defKey: string; at: HookAt; text: string; worldDelta: Record<string, unknown> }
  | { kind: 'objectiveComplete'; defKey: string; stageId: string; objectiveIndex: number }
  | { kind: 'stageAdvanced'; defKey: string; fromStageId: string; toStageId: string }
  | { kind: 'ratingDocked'; defKey: string; amount: number; rating: number }
  | { kind: 'completed'; defKey: string; verb: string; rating: number }
  | { kind: 'paidOut'; defKey: string; cashPaid: number; itemKey?: string; repDelta?: number }
  | { kind: 'failed'; defKey: string; verb: string; reason: 'expired'; stageId: string }
  | { kind: 'voided'; defKey: string; verb: string; npcId: string }
  | { kind: 'restarted'; defKey: string }
  | { kind: 'rearmed'; defKey: string; occupantId: string };

export type MissionStepResult = { run: MissionRun; events: MissionEvent[] };

function stageAt(def: MissionDef, index: number): MissionStage {
  return def.stages[index];
}

function fireHooks(def: MissionDef, at: HookAt, events: MissionEvent[]): void {
  for (const hook of def.hooks) {
    if (hook.at !== at) continue;
    events.push({ kind: 'hookFired', defKey: def.key, at, text: hook.text, worldDelta: hook.worldDelta });
  }
}

/** Cash a completion pays: exactly what the table says. The rating is the
 *  record (it feeds tomorrow's generation weights); it never scales pay. */
export function payoutCash(def: MissionDef): number {
  return def.reward.cash ?? 0;
}

/**
 * The accept. Pure: a fresh run + accepted event + the accept hooks. A
 * position-bound contract arms against the post's CURRENT occupant (resolved
 * from the facts roster when supplied; null = vacant — the exploitable
 * window, nothing to kill yet).
 */
export function acceptMission(def: MissionDef, facts: MissionFacts = {}): MissionStepResult {
  const occupantId = def.binding?.kind === 'position'
    ? facts.occupants?.[def.binding.positionId] ?? null
    : null;
  const run: MissionRun = {
    defKey: def.key,
    status: 'active',
    stageIndex: 0,
    objectiveDone: def.stages[0].objectives.map(() => false),
    ticksActive: 0,
    rating: MISSION_TUNING.rating.base,
    civilianKills: 0,
    occupantId,
    totalCashPaid: 0,
  };
  const events: MissionEvent[] = [{ kind: 'accepted', defKey: def.key }];
  fireHooks(def, 'accept', events);
  fireHooks(def, `stage:${def.stages[0].id}`, events);
  return { run, events };
}

/** Failure degrades, never ends (V22): a FAILED listing restarts at stage
 *  zero (life totals carry). 'voided' is the impossible predicate — it never
 *  revives; completed listings re-list via rearm (position) only. */
export function restartMission(run: MissionRun, def: MissionDef): MissionStepResult {
  if (run.defKey !== def.key) throw new Error(`restartMission: run is "${run.defKey}", definition is "${def.key}"`);
  if (run.status !== 'failed') return { run, events: [] };
  const next: MissionRun = {
    ...run,
    status: 'active',
    stageIndex: 0,
    objectiveDone: def.stages[0].objectives.map(() => false),
    ticksActive: 0,
    rating: MISSION_TUNING.rating.base,
    civilianKills: 0,
  };
  return { run: next, events: [{ kind: 'restarted', defKey: def.key }] };
}

/**
 * V22: a POSITION-bound contract re-arms against the replacement — the racket
 * re-lists when the post refills (diegetic replay; the same listing, a new
 * occupant). Completed and failed runs re-arm; voided cannot exist for
 * position bindings (positions outlive people); person bindings never re-arm
 * (the grievance was about HIM).
 */
export function rearmMission(run: MissionRun, def: MissionDef, occupantId: string): MissionStepResult {
  if (run.defKey !== def.key) throw new Error(`rearmMission: run is "${run.defKey}", definition is "${def.key}"`);
  if (def.binding?.kind !== 'position') {
    throw new Error(`rearmMission("${def.key}"): only POSITION-bound contracts re-arm (V22 — person grievances void with the person)`);
  }
  if (!occupantId) throw new Error(`rearmMission("${def.key}"): a re-arm needs the replacement's npc id`);
  if (run.status === 'active') return { run, events: [] };
  const next: MissionRun = {
    ...run,
    status: 'active',
    stageIndex: 0,
    objectiveDone: def.stages[0].objectives.map(() => false),
    ticksActive: 0,
    rating: MISSION_TUNING.rating.base,
    civilianKills: 0,
    occupantId,
  };
  return { run: next, events: [{ kind: 'rearmed', defKey: def.key, occupantId }] };
}

/** Does any stage of this mission claim this npc's death as an objective?
 *  (Person binding: a kill objective targeting the bound person makes his
 *  death the mission's OWN business — related, never voiding.) */
function missionClaimsKill(def: MissionDef, run: MissionRun, npcId: string, facts: MissionFacts): boolean {
  for (const stage of def.stages) {
    for (const objective of stage.objectives) {
      if (objective.kind !== 'kill') continue;
      const resolved = objective.target?.kind === 'position'
        ? run.occupantId ?? resolveTargetNpc(objective.target, facts)
        : resolveTargetNpc(objective.target, facts);
      if (resolved === npcId) return true;
    }
  }
  return false;
}

/** Resolve a position-targeted objective through the RUN's armed occupant
 *  when it is the bound post (the contract follows its arming), else the
 *  facts roster. */
function objectiveHolds(def: MissionDef, run: MissionRun, objective: MissionStage['objectives'][number], facts: MissionFacts): boolean {
  if (
    objective.target?.kind === 'position'
    && def.binding?.kind === 'position'
    && objective.target.id === def.binding.positionId
    && run.occupantId !== null
  ) {
    const armedFacts: MissionFacts = {
      ...facts,
      occupants: { ...(facts.occupants ?? {}), [objective.target.id]: run.occupantId },
    };
    return evaluateObjective(objective, armedFacts);
  }
  return evaluateObjective(objective, facts);
}

function completeMission(run: MissionRun, def: MissionDef, events: MissionEvent[]): MissionRun {
  fireHooks(def, 'complete', events);
  events.push({ kind: 'completed', defKey: def.key, verb: def.verb, rating: run.rating });
  const cashPaid = payoutCash(def);
  events.push({
    kind: 'paidOut',
    defKey: def.key,
    cashPaid,
    ...(def.reward.itemKey != null ? { itemKey: def.reward.itemKey } : {}),
    ...(def.reward.repDelta != null ? { repDelta: def.reward.repDelta } : {}),
  });
  return { ...run, status: 'completed', totalCashPaid: run.totalCashPaid + cashPaid };
}

/**
 * ONE state tick. Order is fixed (determinism is the contract):
 *   1. collateral: this tick's civilian kills dock the rating per the
 *      table's policy (V22 — the rating is the record, pay is the table's).
 *   2. objectives latch from the facts snapshot; a stage whose objectives all
 *      hold advances; cascades are allowed (two stages can fall to one
 *      well-reported tick); past the last stage the mission completes
 *      (complete hooks fire, the table pays).
 *   3. the binding judges: a PERSON-bound run whose person is down without a
 *      kill objective claiming him VOIDS — the impossible predicate, the one
 *      true fail screen (V22).
 *   4. the tick counts: at the table's expiryTicks the listing FAILS
 *      ('expired'; fail hooks fire) — and failure degrades, never ends:
 *      restartMission/rearmMission revive it.
 * A non-active run returns the SAME reference with no events (the
 * idle-epsilon idiom); an active run always changes (its tick counted).
 */
export function stepMission(run: MissionRun, def: MissionDef, input: MissionTickInput = {}): MissionStepResult {
  if (run.defKey !== def.key) throw new Error(`stepMission: run is "${run.defKey}", definition is "${def.key}"`);
  if (run.status !== 'active') return { run, events: [] };

  const facts = input.facts ?? {};
  const events: MissionEvent[] = [];
  let current = run;

  // 1. collateral docks the rating
  const civilianKills = input.civilianKills ?? 0;
  if (civilianKills > 0 && def.collateral.ratingDeltaPerCivilianKill > 0) {
    const dock = civilianKills * def.collateral.ratingDeltaPerCivilianKill;
    const rating = Math.max(MISSION_TUNING.rating.min, current.rating - dock);
    current = { ...current, rating, civilianKills: current.civilianKills + civilianKills };
    events.push({ kind: 'ratingDocked', defKey: def.key, amount: dock, rating });
  } else if (civilianKills > 0) {
    current = { ...current, civilianKills: current.civilianKills + civilianKills };
  }

  // 2. objectives latch; stages fall; completion cascades
  while (current.status === 'active') {
    const stage = stageAt(def, current.stageIndex);
    let objectiveDone = current.objectiveDone;
    for (let i = 0; i < stage.objectives.length; i++) {
      if (objectiveDone[i]) continue;
      if (!objectiveHolds(def, current, stage.objectives[i], facts)) continue;
      objectiveDone = objectiveDone.map((done, j) => (j === i ? true : done));
      events.push({ kind: 'objectiveComplete', defKey: def.key, stageId: stage.id, objectiveIndex: i });
    }
    if (objectiveDone !== current.objectiveDone) current = { ...current, objectiveDone };
    if (!objectiveDone.every(Boolean)) break;

    const nextIndex = current.stageIndex + 1;
    if (nextIndex >= def.stages.length) {
      current = completeMission(current, def, events);
      break;
    }
    const nextStage = stageAt(def, nextIndex);
    events.push({ kind: 'stageAdvanced', defKey: def.key, fromStageId: stage.id, toStageId: nextStage.id });
    fireHooks(def, `stage:${nextStage.id}`, events);
    current = { ...current, stageIndex: nextIndex, objectiveDone: nextStage.objectives.map(() => false) };
  }

  // 3. the binding judges: unrelated death of the bound PERSON voids
  if (current.status === 'active' && def.binding?.kind === 'person') {
    const { npcId } = def.binding;
    if ((facts.npcsDown ?? []).includes(npcId) && !missionClaimsKill(def, current, npcId, facts)) {
      events.push({ kind: 'voided', defKey: def.key, verb: def.verb, npcId });
      current = { ...current, status: 'voided' };
    }
  }

  // 4. the tick counts; the listing expires at the table's tick
  if (current.status === 'active') {
    const ticksActive = current.ticksActive + 1;
    current = { ...current, ticksActive };
    if (def.expiryTicks !== null && ticksActive >= def.expiryTicks) {
      fireHooks(def, 'fail', events);
      events.push({ kind: 'failed', defKey: def.key, verb: def.verb, reason: 'expired', stageId: stageAt(def, current.stageIndex).id });
      current = { ...current, status: 'failed' };
    }
  }

  return { run: current, events };
}
