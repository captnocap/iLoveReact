// editors/workbench/requests/live.ts — the REQUEST LEDGER store's LIVE
// singleton (REQPANEL-0606; the paint/live.ts split).
//
// ONE SOURCE OF TRUTH, by construction: the deps ARE the ledger module
// tools/request itself runs (docs/game/_index/requests.ts — loadRequests /
// moveRequest over the real docs/game/_requests dir). The cart host has
// the __fs_* doors the module needs (the V20 data layer already flips
// has-fs for hmsc-int). A ledger that can't be read (missing dir, corrupt
// entry) surfaces as the store error instead of a crash.

import {
  defaultRequestsDir,
  loadRequests,
  moveRequest,
  noteRequest,
  tagRequest,
} from '../../../../../docs/game/_index/requests';
import { createRequestsStore, type RequestsStore } from './store';

let live: RequestsStore | null = null;

export function requestsWorkbenchStore(): RequestsStore {
  if (live) return live;
  const dir = defaultRequestsDir();
  let error: string | null = null;
  try {
    loadRequests(dir); // probe once so a broken ledger is namable at init
  } catch (e: any) {
    error = String(e?.message ?? e);
  }
  live = createRequestsStore({
    load: () => loadRequests(dir),
    move: (id, to, input) => moveRequest(dir, id, to, input),
    tag: (id, tags) => tagRequest(dir, id, tags),
    note: (id, by, text) => noteRequest(dir, id, by, text),
    error,
  });
  return live;
}
