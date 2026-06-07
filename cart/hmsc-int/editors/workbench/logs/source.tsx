// editors/workbench/logs/source.tsx — the LOGS WorkbenchSource (WBSET9-0606,
// WORKBENCH.md §6 step 9): the /log churn tail and /settings' session event
// bus folded into ONE streaming category. Roster = feeds (churn ring ·
// session bus · one row per live channel); panel = the feed's properties;
// hero verbs = pause/resume + clear (churn); column 4 = LogStream (dashboard
// band + select/copy + the stream). Both dying routes stay untouched until
// their flip.

import type { WorkbenchSource } from '../../../shell/Workbench';
import { subscribeLiveDoors } from '../livePoll';
import { logsActions, logsLenses, logsPanel, logsRoster } from './panel';
import { logsWorkbenchStore } from './live';
import { LogStream } from './LogStream';

export function logsSource(): WorkbenchSource<string> {
  const store = logsWorkbenchStore();
  return {
    id: 'logs',
    icon: 'Activity',
    kicker: 'LOGS',

    list: () => logsRoster(store),
    select: (rowId: string): string => rowId,
    panel: (id: string) => logsPanel(store, id),
    lenses: (id: string) => logsLenses(id),
    actions: (id: string) => logsActions(store, id),

    // column 4 demonstrates by STREAMING (WORKBENCH.md §1)
    stage: (id: string, lens: string) => <LogStream store={store} channelId={id} lens={lens} />,

    // tail live: ring flushes (census/log.md C7) + the sessions/tunables
    // doors (census/settings.md C5) tick the same frame revision
    subscribe: (fn: () => void) => {
      const offRing = store.deps.ring.subscribe(fn);
      const offDoors = subscribeLiveDoors(fn);
      return () => { offRing(); offDoors(); };
    },
  };
}
