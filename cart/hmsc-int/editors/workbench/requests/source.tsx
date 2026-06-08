// editors/workbench/requests/source.tsx — the REQUEST BOARD WorkbenchSource
// (REQPANEL-0606 → REQBOARD-0607 → REQSEC-0607). Master-detail the right way
// around (the user's layout verdict): roster = views + #tag chips with live
// counts, UNRESOLVED first and default; column 3 (narrow) = THE LIST of asks
// grouped by board section (clicking a row selects); column 4 (wide) = the
// selected request's FULL data — ask verbatim, resolution, history, and the
// BOARD MOVE verbs (claim → doing, finish → review, ✓ accept → done /
// ↩ bounce → new — the SAME moveRequest transition function tools/request
// runs; review→done stays user-gated) — plus the SECRETARY strip (async
// model tagging; unsure → nada; board works untagged).

import type { WorkbenchSource } from '../../../shell/Workbench';
import { requestsActions, requestsPanel, requestsRoster } from './panel';
import { requestsWorkbenchStore } from './live';
import { RequestList } from './RequestList';
import type { RequestsView } from './store';

export function requestsSource(): WorkbenchSource<RequestsView> {
  const store = requestsWorkbenchStore();
  return {
    id: 'requests',
    icon: 'ListChecks',
    kicker: 'REQUESTS',

    list: () => requestsRoster(store),
    select: (rowId: string): RequestsView => rowId as RequestsView,
    panel: (view: RequestsView) => requestsPanel(store, view),
    actions: (view: RequestsView) => requestsActions(store, view),

    // UNRESOLVED is the default view ("what is left")
    defaultRow: (rows) => rows[0]?.id,

    // column 4 demonstrates: the list, newest first; clicks select
    stage: (view: RequestsView) => <RequestList store={store} view={view} />,

    // selection + click-resolves tick the frame
    subscribe: (fn: () => void) => store.subscribe(fn),
  };
}
