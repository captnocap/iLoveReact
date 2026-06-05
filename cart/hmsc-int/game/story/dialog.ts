// game/story/dialog.ts — dialog selection: which lines may be said (V16/V22).
//
// THE SPLIT WITH V16: the cutscene track owns WHEN a line is on screen
// ({at, duration} on the one clock — game/cutscene/); story owns WHICH lines
// exist and WHETHER they may be said right now. Selection is a pure read of
// story state — and that is V22's doctrine made mechanical: a line can only
// be gated by flags/counters, and flags only exist because logged events set
// them (rules.ts), so dialog can never know anything the world didn't
// witness (PROTECT THE ZERO — no backstory reveal has a gate to hang on).
//
// V12 names dialog as needed internal tooling with NO reference
// implementation anywhere in the corpus (scape has dialog-less social
// interactions; hmsc has none) — this is exactly what the rulings describe
// and nothing more: entries, requirement gates, once-latching, deterministic
// pick order. Branching trees / portraits / voice belong to whatever lab
// earns a verdict for them (P5: new ideas graduate in, never sneak in).

import type { StoryCondition } from './conditions';
import { holdsInState } from './conditions';
import type { CutsceneDialogCue } from '../cutscene';
import type { StoryState } from './flags';
import { flagIsSet, setFlag } from './flags';

export type DialogEntry = {
  id: string;
  /** actor id — the head_lab talking face (the V16 speaker convention) */
  speaker: string;
  text: string;
  /** every condition must hold for the line to be sayable (state gates only) */
  requires?: StoryCondition[];
  /** higher wins; equal priority keeps authored order. default 0 */
  priority?: number;
  /** a once-latched line: saying it sets `said.<id>` and it never selects again */
  once?: boolean;
};

/** Validate an authored dialog set — fails loud at build time (the
 *  createCutscene rule): ids unique, gates state-only (an event gate on a
 *  dialog line is an authoring bug — lines read the story, rules eat events). */
export function createDialogSet(entries: DialogEntry[]): DialogEntry[] {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry.id) throw new Error('story: a dialog entry needs an id');
    if (seen.has(entry.id)) throw new Error(`story: dialog entry '${entry.id}' declared twice`);
    seen.add(entry.id);
    if (!entry.speaker) throw new Error(`story: dialog entry '${entry.id}' needs a speaker`);
    if (!entry.text) throw new Error(`story: dialog entry '${entry.id}' needs text`);
    for (const gate of entry.requires ?? []) {
      if (gate.kind === 'event') {
        throw new Error(`story: dialog entry '${entry.id}' gates on a live event — gate on the flag a rule sets instead`);
      }
    }
  }
  return entries;
}

export function saidFlagKey(entry: DialogEntry): string {
  return `said.${entry.id}`;
}

/** Is this one line sayable right now? */
export function dialogAvailable(entry: DialogEntry, story: StoryState): boolean {
  if (entry.once && flagIsSet(story, saidFlagKey(entry))) return false;
  for (const gate of entry.requires ?? []) {
    if (!holdsInState(gate, story)) return false;
  }
  return true;
}

/** THE SELECTION RULE: every sayable line, highest priority first, authored
 *  order breaking ties. Pure and deterministic — the same story state always
 *  selects the same lines in the same order. */
export function selectDialog(entries: readonly DialogEntry[], story: StoryState): DialogEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => dialogAvailable(entry, story))
    .sort((a, b) => (b.entry.priority ?? 0) - (a.entry.priority ?? 0) || a.index - b.index)
    .map(({ entry }) => entry);
}

/** Saying a once-line latches it into story state (`said.<id>` — a plain
 *  flag, so it persists, revives, and gates like any other fact). Non-once
 *  lines change nothing (same reference). */
export function markSaid(story: StoryState, entry: DialogEntry): StoryState {
  if (!entry.once) return story;
  return setFlag(story, saidFlagKey(entry), true);
}

/** The V16 seam: place a selected line on a cutscene clock. The cutscene's
 *  own createCutscene validates at/duration against the scene. */
export function asCutsceneCue(entry: DialogEntry, at: number, duration: number): CutsceneDialogCue {
  return { at, duration, speaker: entry.speaker, text: entry.text };
}
