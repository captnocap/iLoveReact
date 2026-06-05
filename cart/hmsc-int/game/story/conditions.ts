// game/story/conditions.ts — predicates as data (P2), shared by arcs + dialog.
//
// A condition is a record, never a closure: the tuning/story editor can list,
// edit, and validate every gate in the game. Three kinds — two read story
// STATE (flag, counter), one matches a live EVENT (the consequence hook).

import type { StoryEvent } from './events';
import type { StoryState, StoryValue } from './flags';
import { flagIsSet, getCounter, getFlag } from './flags';

export type StoryCondition =
  /** flag gate — `equals` omitted means "truthy" */
  | { kind: 'flag'; flag: string; equals?: StoryValue }
  /** counter gate — at least N */
  | { kind: 'counter'; counter: string; atLeast: number }
  /** event gate — matches a live event by type (and subject id when given) */
  | { kind: 'event'; type: string; subjectId?: string };

/** Does a STATE condition hold? Event conditions never hold against state
 *  alone — they need a live event (matchesEvent). */
export function holdsInState(condition: StoryCondition, story: StoryState): boolean {
  switch (condition.kind) {
    case 'flag':
      return 'equals' in condition && condition.equals !== undefined
        ? getFlag(story, condition.flag) === condition.equals
        : flagIsSet(story, condition.flag);
    case 'counter':
      return getCounter(story, condition.counter) >= condition.atLeast;
    case 'event':
      return false;
  }
}

/** Does a live event satisfy an EVENT condition? State conditions ignore events. */
export function matchesEvent(condition: StoryCondition, event: StoryEvent): boolean {
  if (condition.kind !== 'event') return false;
  if (event.type !== condition.type) return false;
  if (condition.subjectId !== undefined && event.subject?.id !== condition.subjectId) return false;
  return true;
}
