// game/story/rules.ts — event → flag rules (the useHmscEventRules capture).
//
// The hmsc reference installs story rules as useIFTTT callbacks that setState
// and re-publish. Captured PURE (the perception precedent): applyRules reads
// (rules, story, event) and returns the next story plus the provenance events
// to record — `story.flag.set` with parentId pointing at the trigger, exactly
// the hmsc emission. Nothing dispatches here; the shell/loop subscribes the
// bus, calls this, records the effects through the event log, and publishes.
//
// A rule's flag derivation is a pure function of the event (the hmsc rules
// build keys like `lab.${name}.visited` from event fields — that derivation
// can't be a static record, so it is the one place a function lives in the
// data; cutscene's params-as-pure-function is the precedent).

import type { StoryEvent, StoryEventInput, StoryEventRef } from './events';
import type { StoryState, StoryValue } from './flags';
import { setFlag } from './flags';

export type FlagWrite = { key: string; value: StoryValue; reason: string };

export type StoryRule = {
  id: string;
  /** event type this rule listens to */
  on: string;
  /** derive the flag write from the event; null = not applicable after all */
  derive: (event: StoryEvent) => FlagWrite | null;
};

export type RulesResult = {
  story: StoryState;
  /** `story.flag.set` provenance events to record — empty when nothing changed */
  effects: StoryEventInput[];
};

const RULES_ACTOR: StoryEventRef = { kind: 'story', id: 'story.rules' };

/** Run every applicable rule over one event. Same story reference back when
 *  no flag actually changed (a re-fired event sets nothing twice). */
export function applyRules(
  rules: readonly StoryRule[],
  story: StoryState,
  event: StoryEvent,
): RulesResult {
  let next = story;
  const effects: StoryEventInput[] = [];
  for (const rule of rules) {
    if (rule.on !== event.type) continue;
    const write = rule.derive(event);
    if (!write) continue;
    const flagged = setFlag(next, write.key, write.value);
    if (flagged === next) continue;            // already set — no effect, no event
    next = flagged;
    effects.push({
      type: 'story.flag.set',
      source: 'story.rules',
      occurredAt: event.occurredAt,            // derived events carry the trigger's stamp
      actor: RULES_ACTOR,
      ...(event.subject ? { subject: event.subject } : {}),
      parentId: event.id,
      tags: ['story'],
      payload: { flag: write.key, value: write.value, reason: write.reason, rule: rule.id },
    });
  }
  return { story: next, effects };
}

// ── the shipped rules (the two hmsc story rules, as data) ────────────────────

export const STORY_RULES: readonly StoryRule[] = Object.freeze([
  {
    id: 'lab-visited',
    on: 'lab.entered',
    derive: (event) =>
      event.subject?.kind === 'lab'
        ? { key: `lab.${event.subject.id}.visited`, value: true, reason: 'lab.entered' }
        : null,
  },
  {
    id: 'trigger-seen',
    on: 'world.trigger.entered',
    derive: (event) =>
      typeof event.payload.label === 'string'
        ? { key: `trigger.${event.subject?.id ?? 'unknown'}.seen`, value: true, reason: 'world.trigger.entered' }
        : null,
  },
]);
