// editors/workbench/story/source.tsx — the STORYLINE WorkbenchSource: the
// conditional-state-machine board the user asked for, authoring into the
// EXISTING substrate (game/missions defs + game/story conditions), never a
// parallel schema. Gutter 2 = the quest roster (grouped by questline); gutter 3
// = the selected quest's MissionDef shape (identity, the V22 person|position
// contract, the unlock gates, reward, flow); gutter 4 = the board itself,
// quests laid out in dependency columns.
//
// The board's edges come for free from the data: a quest provides the flags its
// hooks set, requires the flags its gates name, and provider→requirer IS the
// edge (model.ts). Editing a gate in the panel reshapes the machine next frame.

import type { WorkbenchSource } from '../../../shell/Workbench';
import { storyPanel, storyRoster } from './panel';
import { StoryBoard } from './StoryBoard';
import { storyWorkbenchStore } from './store';

export function storySource(): WorkbenchSource<string> {
  const store = storyWorkbenchStore();
  return {
    id: 'story',
    icon: 'GitBranch',
    kicker: 'STORYLINE',

    list: () => storyRoster(store),
    select: (rowId: string): string => rowId,
    // selection lives in the store (the single truth): roster picks AND board
    // card clicks both route through store.select, so panel + board never
    // diverge. onPick is the contract's home for the load side-effect.
    onPick: (rowId: string) => store.select(rowId),
    panel: (subject: string) => storyPanel(store, store.selectedKey() ?? subject),

    // the stage IS the board — values + selection only (LAW 1); the side-effect
    // is the user's click inside it, never render.
    stage: () => <StoryBoard store={store} />,

    defaultRow: (rows) => rows[0]?.id,
    subscribe: (fn: () => void) => store.subscribe(fn),
  };
}
