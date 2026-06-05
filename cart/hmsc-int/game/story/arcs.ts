// game/story/arcs.ts — narrative arcs: staged progressions over the log (V22).
//
// An arc is a LINEAR sequence of stages (V22's opening is a straight line of
// beats); a stage completes when its `advanceOn` condition holds. Advancement
// is a pure step over (story state, optional consequence event) — the V12
// hookup: perception's events get recorded into the log, the loop hands each
// one here, and arcs move. Nothing here owns a clock or dispatches anything;
// effects come back as event INPUTS to record (`story.arc.advanced` /
// `story.arc.completed` with parentId provenance — the rules.ts emission
// pattern).
//
// CASCADE SEMANTICS (the perception single-step-cascade precedent): one call
// advances through every consecutive stage whose STATE condition already
// holds, but a live EVENT is consumed by AT MOST ONE stage — two beats can't
// both claim the same gunshot.

import type { StoryCondition } from './conditions';
import { holdsInState, matchesEvent } from './conditions';
import type { StoryEvent, StoryEventInput } from './events';
import type { StoryState } from './flags';

export type ArcStage = {
  id: string;
  /** the stage is COMPLETE when this holds — flag/counter (state) or event */
  advanceOn: StoryCondition;
};

export type ArcDef = {
  id: string;
  stages: ArcStage[];
};

/** Where one arc is. `stage` indexes the CURRENT (incomplete) stage;
 *  stage === stages.length means the arc is done. JSON-serializable. */
export type ArcState = {
  arc: string;
  stage: number;
};

/** Validate the authored def — fails loud at build time (the createCutscene rule). */
export function createArc(def: ArcDef): ArcDef {
  if (!def.id) throw new Error('story: an arc needs an id');
  if (!def.stages || def.stages.length === 0) {
    throw new Error(`story: arc '${def.id}' needs at least one stage`);
  }
  const seen = new Set<string>();
  for (const stage of def.stages) {
    if (!stage.id) throw new Error(`story: arc '${def.id}' has a stage without an id`);
    if (seen.has(stage.id)) throw new Error(`story: arc '${def.id}' declares stage '${stage.id}' twice`);
    seen.add(stage.id);
  }
  return def;
}

export function startArc(def: ArcDef): ArcState {
  return { arc: def.id, stage: 0 };
}

export function arcDone(def: ArcDef, state: ArcState): boolean {
  return state.stage >= def.stages.length;
}

export function currentStage(def: ArcDef, state: ArcState): ArcStage | null {
  return arcDone(def, state) ? null : def.stages[state.stage];
}

export type ArcAdvanceInput = {
  /** the live consequence event, when one drove this call */
  event?: StoryEvent;
  /** stamp for the derived events; defaults to the event's */
  occurredAt?: string;
};

export type ArcAdvanceResult = {
  state: ArcState;
  /** events to record: one `story.arc.advanced` per stage passed, then
   *  `story.arc.completed` when the last stage falls — [] when nothing moved */
  effects: StoryEventInput[];
};

/** The pure advancement step. Same state reference back when nothing moves. */
export function advanceArc(
  def: ArcDef,
  state: ArcState,
  story: StoryState,
  input: ArcAdvanceInput = {},
): ArcAdvanceResult {
  if (state.arc !== def.id) {
    throw new Error(`story: arc state '${state.arc}' handed to arc def '${def.id}'`);
  }
  const occurredAt = input.occurredAt ?? input.event?.occurredAt;
  let stage = state.stage;
  let eventSpent = false;
  const effects: StoryEventInput[] = [];

  while (stage < def.stages.length) {
    const gate = def.stages[stage].advanceOn;
    let complete = false;
    if (gate.kind === 'event') {
      complete = !eventSpent && input.event !== undefined && matchesEvent(gate, input.event);
      if (complete) eventSpent = true;          // one event moves at most one beat
    } else {
      complete = holdsInState(gate, story);
    }
    if (!complete) break;

    if (occurredAt === undefined) {
      throw new Error(`story: arc '${def.id}' advanced with no occurredAt stamp (pass the event or a stamp)`);
    }
    const from = def.stages[stage].id;
    stage += 1;
    const to = stage < def.stages.length ? def.stages[stage].id : null;
    effects.push({
      type: 'story.arc.advanced',
      source: 'story.arcs',
      occurredAt,
      actor: { kind: 'story', id: 'story.arcs' },
      subject: { kind: 'story', id: def.id },
      ...(input.event ? { parentId: input.event.id } : {}),
      tags: ['story', 'arc'],
      payload: { arc: def.id, from, to },
    });
    if (stage >= def.stages.length) {
      effects.push({
        type: 'story.arc.completed',
        source: 'story.arcs',
        occurredAt,
        actor: { kind: 'story', id: 'story.arcs' },
        subject: { kind: 'story', id: def.id },
        ...(input.event ? { parentId: input.event.id } : {}),
        tags: ['story', 'arc'],
        payload: { arc: def.id },
      });
    }
  }

  return stage === state.stage ? { state, effects } : { state: { arc: def.id, stage }, effects };
}

// ── the shipped arc: V22's ruled opening ─────────────────────────────────────
//
// The seven beats are VERDICT TEXT (V22, "The opening"); the advance flags
// are first-cut names (unruled — one edit each to re-rule). All state-gated:
// whatever system plays a beat (mission, command, cutscene) sets the flag,
// and the arc follows the log. The one ruled CONSTRAINT is encoded in stage
// 5's flag name: the unfair-rating beat MUST cost visible money before the
// pivot — the gate IS the cost having been paid.

export const OPENING_ARC: ArcDef = createArc({
  id: 'opening',
  stages: [
    { id: 'sky-ramp-dream', advanceOn: { kind: 'flag', flag: 'opening.dream.done' } },
    { id: 'wake-broke-high', advanceOn: { kind: 'flag', flag: 'opening.wake.done' } },
    { id: 'fired', advanceOn: { kind: 'flag', flag: 'opening.fired.done' } },
    { id: 'job-hunt', advanceOn: { kind: 'flag', flag: 'opening.job-hunt.done' } },
    { id: 'delivery-gig', advanceOn: { kind: 'flag', flag: 'opening.unfair-rating.cost-paid' } },
    { id: 'tweaker-scare', advanceOn: { kind: 'flag', flag: 'opening.tweaker-scare.done' } },
    { id: 'crime-as-a-service', advanceOn: { kind: 'flag', flag: 'opening.caas.unlocked' } },
  ],
});
