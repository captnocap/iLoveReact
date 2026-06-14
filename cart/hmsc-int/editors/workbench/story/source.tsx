// editors/workbench/story/source.tsx — the STORYLINE WorkbenchSource: the
// questline-first authoring board (req_0919/req_0920). Gutter 2 = the roster of
// questlines, each with its missions nested under it; gutter 3 = the selected
// questline OR mission's panel; gutter 4 = the board (the selected line's
// missions laid out in dependency columns).
//
// THE HIERARCHY (the user's ruling): a questline is the top, always — you pick
// or create one before anything else. The builder starts EMPTY, so the only
// move on a blank board is "New Questline" (emptyActions). Once a line exists,
// "New Mission" adds to it. Selection truth lives in the store; the roster
// highlight mirrors it through defaultRow, and onPick installs the load.

import type { WorkbenchSource, ActionSpec, RosterRow } from '../../../shell/Workbench';
import { storyPanel, storyRoster, parseRowId, lineRowId, missionRowId } from './panel';
import { StoryBoard } from './StoryBoard';
import { storyWorkbenchStore } from './store';

export function storySource(): WorkbenchSource<string> {
  const store = storyWorkbenchStore();

  // the row id the store's current selection maps to (mission wins over line).
  const currentRowId = (): string | undefined => {
    const line = store.selectedLineId();
    if (!line) return undefined;
    const key = store.selectedKey();
    return key && store.draft(key) ? missionRowId(line, key) : lineRowId(line);
  };

  const newQuestline: ActionSpec = { id: 'new-line', label: 'New Questline', icon: 'Plus', run: () => store.newQuestline() };

  return {
    id: 'story',
    icon: 'GitBranch',
    kicker: 'STORYLINE',

    list: () => storyRoster(store),
    select: (rowId: string): string => rowId,
    // roster click → install the selection in the store (render stays pure).
    onPick: (rowId: string) => {
      const parsed = parseRowId(rowId);
      if (!parsed) return;
      store.selectLine(parsed.line);
      store.select(parsed.mission ?? null);
    },
    panel: () => storyPanel(store),

    // before the first questline exists, the only sensible verb is creation.
    emptyActions: () => [newQuestline],
    actions: () => {
      const out: ActionSpec[] = [newQuestline];
      const lineId = store.selectedLineId();
      if (!lineId) return out;
      const key = store.selectedKey();
      if (key && store.draft(key)) {
        out.push({ id: 'del-mission', label: '✕ Delete Mission', run: () => store.removeMission(key) });
      } else {
        out.push({ id: 'new-mission', label: '+ New Mission', icon: 'Plus', run: () => store.newMission() });
        out.push({ id: 'del-line', label: '✕ Delete Questline', run: () => store.removeQuestline(lineId) });
      }
      return out;
    },

    // the stage IS the board — values + selection only (LAW 1).
    stage: () => <StoryBoard store={store} />,

    // the highlight follows the store: prefer its selection, else the first row.
    defaultRow: (rows: RosterRow[]) => currentRowId() ?? rows[0]?.id,
    subscribe: (fn: () => void) => store.subscribe(fn),
  };
}
