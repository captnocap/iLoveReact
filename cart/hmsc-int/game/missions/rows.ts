// game/missions/rows.ts — the CaaS daily: an LLM-GENERATED MISSION ROW over a
// CLOSED SCHEMA (V22). The generation pipeline the verdict rules:
//
//   generation offline → validateRow proves the row against the QUERYABLE
//   FUTURE (methods_hinted are AFFORDANCES GUARANTEED) → the V19 verify bot
//   plays it headless → players see it.
//
// THE NUMBERS LAW: the LLM never touches numbers. A row carries ONLY ids,
// keys, names, and text — validateRow REJECTS numeric slots anywhere in it;
// missionFromRow prices the gig (reward, expiry, collateral) from
// MISSION_TUNING (P2). Consequence: row objectives are the target-shaped
// kinds (kill/reach-zone/acquire/talk/use_site); amount-shaped objectives
// (earn/evade) and point coordinates are authored-table territory.
//
// DEDUP (V22: "seed + embedding fingerprint — dedup window = no-doubles for
// narrative"): a row sharing a seed with, or fingerprint-similar to, any of
// the last MISSION_TUNING.dedup.window accepted rows is a double.
//
// The validator COLLECTS problems (the pipeline wants the full list to feed
// back to the generator); missionFromRow throws on any (fail-loud at the
// boundary a game would actually load through).

import { GAME_ACTIVITIES, type ActivityVerb } from '../activities';
import type { HookAt, MissionBinding, MissionDef, NarrativeHook } from './defs';
import { defineMission } from './defs';
import type { MissionObjective, ObjectiveTarget } from './objectives';
import { MISSION_TUNING } from './tuning';

/** A row objective: a kind + named slots, never a number, never coordinates. */
export type RowObjective = {
  kind: 'kill' | 'reach' | 'acquire' | 'talk' | 'use_site';
  brief: string;
  /** npc / position / zone / site id-or-key, per kind (validated) */
  targetSlot?: { kind: 'npc' | 'position' | 'zone' | 'site'; id: string };
  itemKey?: string;
};

export type MissionRow = {
  key: string;
  title: string;
  /** the closed verb set — the same A/B-tested space activities ships */
  verb: ActivityVerb;
  /** who posted it (two-sided missions fall out free) */
  client: string;
  /** contracts bind PERSON (grievance) or POSITION (racket) — required on rows */
  binding: MissionBinding;
  objectives: RowObjective[];
  /** affordances the generator leaned on — every one must be GUARANTEED */
  methodsHinted: string[];
  /** (text, world_delta) pairs — a hook without a delta is a liar (V22) */
  narrativeHooks: { at: HookAt; text: string; worldDelta: Record<string, unknown> }[];
  /** expiry SEMANTIC name → ticks via MISSION_TUNING.expiry */
  expiry: string;
  /** collateral POLICY name → MISSION_TUNING.collateral */
  collateral: string;
  /** generation provenance + the dedup key */
  seed: string;
  /** embedding fingerprint — unit-ish vector for the similarity window */
  fingerprint: number[];
};

/**
 * The queryable future, as data: what the world GUARANTEES exists. The
 * validator proves every slot the row references against this — a daily that
 * names a ghost npc or an unguaranteed method never reaches a player.
 */
export type MissionAffordances = {
  npcs: readonly string[];
  positions: readonly string[];
  zones: readonly string[];
  sites: readonly string[];
  items: readonly string[];
  /** affordances guaranteed by the engines (chance-engine LoS checks etc.) */
  methods: readonly string[];
};

export type RowVerdict = { ok: boolean; problems: string[] };

/** every row compiles to one stage; its hooks address it by this id */
export const ROW_STAGE_ID = 'contract';

const ROW_TARGET_POOL: Record<RowObjective['kind'], readonly ('npcs' | 'positions' | 'zones' | 'sites')[] | null> = {
  kill: ['npcs', 'positions'],
  reach: ['zones'],
  acquire: null,
  talk: ['npcs', 'positions'],
  use_site: ['sites'],
};

/** Any number anywhere in the row body (outside the fingerprint) breaks the
 *  numbers law. Walks plain JSON; the fingerprint is generation provenance,
 *  not a slot the LLM "wrote" — it is exempt by the schema. */
function findNumericSlots(value: unknown, path: string, problems: string[]): void {
  if (typeof value === 'number') {
    problems.push(`${path}: the LLM never touches numbers — ${value} must come from a tuning table (P2)`);
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => findNumericSlots(item, `${path}[${i}]`, problems));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) findNumericSlots(v, `${path}.${k}`, problems);
  }
}

/** Prove the row against the queryable future. Collects every problem. */
export function validateRow(row: MissionRow, affordances: MissionAffordances): RowVerdict {
  const problems: string[] = [];
  if (!row.key) problems.push('key: required');
  if (!row.title) problems.push('title: required');
  if (!GAME_ACTIVITIES.isVerb(row.verb)) problems.push(`verb: ${JSON.stringify(row.verb)} is not in the closed verb set`);
  if (!row.client) problems.push('client: required (two-sided missions need a poster)');

  if (!row.binding) {
    problems.push('binding: required — a contract binds PERSON or POSITION (V22)');
  } else if (row.binding.kind === 'person') {
    if (!affordances.npcs.includes(row.binding.npcId)) problems.push(`binding: npc "${row.binding.npcId}" is not in the queryable future`);
  } else if (row.binding.kind === 'position') {
    if (!affordances.positions.includes(row.binding.positionId)) problems.push(`binding: position "${row.binding.positionId}" is not in the queryable future`);
  } else {
    problems.push(`binding: unknown kind ${JSON.stringify((row.binding as { kind?: string }).kind)}`);
  }

  if (!row.objectives || row.objectives.length === 0) problems.push('objectives: at least one is required');
  for (const [i, objective] of (row.objectives ?? []).entries()) {
    const where = `objectives[${i}]`;
    const pools = ROW_TARGET_POOL[objective.kind];
    if (pools === undefined) { problems.push(`${where}: unknown kind ${JSON.stringify(objective.kind)}`); continue; }
    if (!objective.brief) problems.push(`${where}: brief required`);
    if (pools === null) {
      if (objective.kind === 'acquire') {
        if (!objective.itemKey) problems.push(`${where}: acquire needs an itemKey`);
        else if (!affordances.items.includes(objective.itemKey)) problems.push(`${where}: item "${objective.itemKey}" is not in the queryable future`);
      }
    } else {
      const slot = objective.targetSlot;
      if (!slot) { problems.push(`${where}: ${objective.kind} needs a targetSlot`); continue; }
      const pool = (`${slot.kind}s` as 'npcs' | 'positions' | 'zones' | 'sites');
      if (!pools.includes(pool)) {
        problems.push(`${where}: ${objective.kind} cannot target a ${slot.kind}`);
      } else if (!affordances[pool].includes(slot.id)) {
        problems.push(`${where}: ${slot.kind} "${slot.id}" is not in the queryable future`);
      }
    }
  }

  for (const method of row.methodsHinted ?? []) {
    if (!affordances.methods.includes(method)) {
      problems.push(`methodsHinted: "${method}" is not guaranteed — methods_hinted are AFFORDANCES GUARANTEED (V22)`);
    }
  }

  for (const [i, hook] of (row.narrativeHooks ?? []).entries()) {
    if (!hook.text) problems.push(`narrativeHooks[${i}]: text required`);
    if (!hook.worldDelta || Object.keys(hook.worldDelta).length === 0) {
      problems.push(`narrativeHooks[${i}]: no world_delta — a hook without a delta is the world calling the app a liar (V22)`);
    }
    // a row compiles to ONE stage ('contract') — only its hooks are addressable
    if (hook.at !== 'accept' && hook.at !== 'complete' && hook.at !== 'fail' && hook.at !== `stage:${ROW_STAGE_ID}`) {
      problems.push(`narrativeHooks[${i}]: at ${JSON.stringify(hook.at)} — rows know accept/complete/fail/stage:${ROW_STAGE_ID}`);
    }
  }

  if (!(row.expiry in MISSION_TUNING.expiry)) {
    problems.push(`expiry: unknown semantic ${JSON.stringify(row.expiry)} (have: ${Object.keys(MISSION_TUNING.expiry).join(', ')})`);
  }
  if (!(row.collateral in MISSION_TUNING.collateral)) {
    problems.push(`collateral: unknown policy ${JSON.stringify(row.collateral)} (have: ${Object.keys(MISSION_TUNING.collateral).join(', ')})`);
  }
  if (!row.seed) problems.push('seed: required (generation provenance)');
  if (!Array.isArray(row.fingerprint) || row.fingerprint.length === 0) problems.push('fingerprint: required (the dedup window keys off it)');

  const { fingerprint: _exempt, ...numbersScope } = row;
  findNumericSlots(numbersScope, 'row', problems);

  return { ok: problems.length === 0, problems };
}

// ── the dedup window (no-doubles for narrative) ──────────────────────────────

/** Cosine similarity over fingerprints; 0 when either has no magnitude. */
export function fingerprintSimilarity(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; }
  for (const v of a) magA += v * v;
  for (const v of b) magB += v * v;
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/** Is this row a double of anything in the recent window? Same seed always
 *  is; otherwise fingerprint similarity ≥ tuning.dedup.threshold within the
 *  last tuning.dedup.window rows. */
export function isDuplicateRow(row: MissionRow, recent: readonly MissionRow[]): boolean {
  const window = recent.slice(-MISSION_TUNING.dedup.window);
  return window.some((prior) =>
    prior.seed === row.seed
    || fingerprintSimilarity(prior.fingerprint, row.fingerprint) >= MISSION_TUNING.dedup.threshold);
}

// ── row → mission (the pricing boundary) ─────────────────────────────────────

function rowObjectiveToMission(objective: RowObjective): MissionObjective {
  let target: ObjectiveTarget | undefined;
  if (objective.targetSlot) {
    const slot = objective.targetSlot;
    target = slot.kind === 'npc' ? { kind: 'npc', id: slot.id }
      : slot.kind === 'position' ? { kind: 'position', id: slot.id }
      : slot.kind === 'zone' ? { kind: 'zone', key: slot.id }
      : { kind: 'site', key: slot.id };
  }
  return {
    kind: objective.kind,
    brief: objective.brief,
    ...(target ? { target } : {}),
    ...(objective.itemKey ? { itemKey: objective.itemKey } : {}),
  };
}

/**
 * Compile a validated row into a runnable MissionDef, pricing every number
 * from MISSION_TUNING (the platform diegetically reprices the client's
 * offer). Throws on any validation problem — this is the boundary a game
 * actually loads a daily through; the collect-all verdict is validateRow's.
 */
export function missionFromRow(row: MissionRow, affordances: MissionAffordances): MissionDef {
  const verdict = validateRow(row, affordances);
  if (!verdict.ok) {
    throw new Error(`missionFromRow("${row?.key ?? '?'}"): row failed validation —\n  ${verdict.problems.join('\n  ')}`);
  }
  const hooks: NarrativeHook[] = row.narrativeHooks.map((hook) => ({
    at: hook.at, text: hook.text, worldDelta: { ...hook.worldDelta },
  }));
  return defineMission({
    key: row.key,
    title: row.title,
    verb: row.verb,
    client: row.client,
    binding: row.binding,
    stages: [{
      id: ROW_STAGE_ID,
      brief: row.title,
      objectives: row.objectives.map(rowObjectiveToMission),
    }],
    reward: { cash: MISSION_TUNING.pricing[row.verb] },
    expiryTicks: MISSION_TUNING.expiry[row.expiry],
    collateral: MISSION_TUNING.collateral[row.collateral],
    hooks,
    seed: row.seed,
    fingerprint: [...row.fingerprint],
  });
}
