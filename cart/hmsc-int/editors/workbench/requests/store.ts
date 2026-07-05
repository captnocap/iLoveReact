// editors/workbench/requests/store.ts — the REQUEST BOARD source's headless
// store (REQPANEL-0606 → REQBOARD-0607 board → REQSEC-0607 secretary tags).
//
// USER ASK, verbatim: "for the request method we have been doing where its
// recorded, we should get someone to make a simple interface for us from the
// data. just so i can see what is left unresolved and can click it was
// resolved or not".
//
// ONE SOURCE OF TRUTH: this store drives the SAME machinery as tools/request
// — docs/game/_index/requests.ts is the one module both consume (live.ts
// passes loadRequests/moveRequest/tagRequest over the real docs/game/_requests
// dir; tests pass the same functions over a temp dir). There is NO parallel
// status store and NO parallel tag store: a click-resolve advances the board
// through legal transitions to done, tags persist through tagRequest, and
// the interface SURFACES the one-way terminal state instead of inventing an
// unresolve.
//
// Supervisor dispatches (origin 'supervisor-dispatch', marker-tracked) stay
// hidden from every default view — exactly `tools/request list --open` —
// behind their own DISPATCHES view.
//
// TAG VIEWS (REQSEC-0607): every tag in use is a view of its own —
// `tag:<name>` — so the rail carries #bug / #ux / … chips and "search by
// tag" is just selecting one. Tags are organization ONLY.

import {
  DISPATCH_ORIGIN,
  ONEOFF_ORIGIN,
  isOffBoard,
  allTags,
  type MoveInput,
  type RequestRecord,
  type RequestStatus,
} from '../../../../../docs/game/_index/requests';

export type RequestsView = 'unresolved' | 'resolved' | 'all' | 'dispatches' | 'one-offs' | `tag:${string}`;

export const REQUESTS_VIEWS: Array<{ id: RequestsView; label: string }> = [
  { id: 'unresolved', label: 'unresolved' }, // the default — "what is left"
  { id: 'resolved', label: 'resolved' },
  { id: 'all', label: 'all asks' },
  { id: 'dispatches', label: 'dispatches' },
  { id: 'one-offs', label: 'one-offs' },     // REQSCOPE-0705: unrelated asks, off-board
];

/** The user-click resolution paragraph — a real paragraph (the ledger's
 *  MIN_RESOLUTION_CHARS bar), honest about how the entry closed. */
export const USER_CLICK_RESOLUTION =
  'Resolved by the user via the workbench request panel (REQPANEL-0606): the user reviewed this ask in the interface and marked it done by hand. No commit SHAs attached from the panel — the work, if any, lives in the surrounding commits of the same date.';

export type RequestsStoreDeps = {
  /** every ledger entry (live: loadRequests over docs/game/_requests) */
  load(): RequestRecord[];
  /** THE board transition door (live: moveRequest — same module tools/request runs) */
  move(id: string, to: RequestStatus, input: MoveInput): RequestRecord;
  /** THE tag persistence door (live: tagRequest — union, organization only) */
  tag(id: string, tags: string[]): RequestRecord;
  /** THE note door (live: noteRequest — append-only history) */
  note(id: string, by: string, text: string): RequestRecord;
  /** why the ledger is unreadable, when it is */
  error: string | null;
};

export type RequestsStore = {
  deps: RequestsStoreDeps;
  /** a view's entries, newest first */
  rowsFor(view: RequestsView): RequestRecord[];
  counts(): Record<string, number>;
  /** every tag in use, sorted — the rail's #chips */
  tagsInUse(): string[];
  /** the close-now click: walks the legal moves to done in one go
   *  (new→doing→review→done) with the user-click paragraph. USER-INITIATED
   *  ONLY (REQBOARD-0607 reconciliation ruling): the final review→done is
   *  always actor 'user' — never call this from machinery that isn't the
   *  user's own click. One-way; throws on an already-done id, like the CLI. */
  markResolvedByUser(id: string): RequestRecord;
  /** ONE board move (REQBOARD-0607 — the panel's verbs are the board's
   *  verbs): doing/review moves are panel machinery (actor 'workbench', the
   *  canned paragraph at the review edge); done (accept) and new (bounce)
   *  carry the USER's word (actor 'user' — review→done stays user-gated).
   *  Illegal moves are REFUSED by the transition function itself. */
  moveByUser(id: string, to: RequestStatus): RequestRecord;
  /** the SECRETARY's apply door: union tags onto an entry (organization
   *  only; junk drops silently in the ledger module — never an error). */
  applyTags(id: string, tags: string[]): RequestRecord;
  /** the user's COMMENT (REQSEC-0607 addendum: "leave comments on things so
   *  that it can be used as a place i can go through and say if it is
   *  correct or not") — appends a note event as actor 'user' through the
   *  same noteRequest door; welcome in ANY state, even done. */
  noteByUser(id: string, text: string): RequestRecord;
  record(id: string): RequestRecord | null;
  // selection (view state): the request the panel inspects
  selectedId(): string | null;
  select(id: string | null): void;
  subscribe(fn: () => void): () => void;
  error(): string | null;
};

function isDispatch(record: RequestRecord): boolean {
  return record.origin === DISPATCH_ORIGIN;
}

function inView(record: RequestRecord, view: RequestsView): boolean {
  if (view === 'dispatches') return isDispatch(record);
  if (view === 'one-offs') return record.origin === ONEOFF_ORIGIN;
  if (isOffBoard(record)) return false; // hidden by default, the --open rule
  if (view.startsWith('tag:')) return (record.tags ?? []).includes(view.slice(4));
  if (view === 'unresolved') return record.status !== 'done';
  if (view === 'resolved') return record.status === 'done';
  return true; // 'all' (still off-board-free)
}

export function createRequestsStore(deps: RequestsStoreDeps): RequestsStore {
  let selected: string | null = null;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const fn of Array.from(listeners)) {
      try { fn(); } catch { /* a dead subscriber never kills the store */ }
    }
  };

  const all = (): RequestRecord[] => {
    try { return deps.load(); } catch { return []; }
  };

  return {
    deps,
    rowsFor(view: RequestsView): RequestRecord[] {
      // newest first — the freshest ask is the one being triaged
      return all().filter((r) => inView(r, view)).reverse();
    },
    counts(): Record<string, number> {
      const records = all();
      const counts: Record<string, number> = { unresolved: 0, resolved: 0, all: 0, dispatches: 0, 'one-offs': 0 };
      for (const tag of allTags(records)) counts[`tag:${tag}`] = 0;
      for (const record of records) {
        for (const view of Object.keys(counts) as RequestsView[]) {
          if (inView(record, view)) counts[view] += 1;
        }
      }
      return counts;
    },
    tagsInUse(): string[] {
      return allTags(all());
    },
    markResolvedByUser(id: string): RequestRecord {
      let current = all().find((r) => r.id === id) ?? null;
      if (!current) throw new Error(`no such request: ${id}`);
      if (current.status === 'done') throw new Error(`${id} is already-resolved by the ledger itself`);
      if (current.status === 'new') {
        current = deps.move(id, 'doing', { by: 'workbench', note: 'claimed by the workbench request panel for user closure' });
      }
      if (current.status === 'doing') {
        current = deps.move(id, 'review', { by: 'workbench', para: USER_CLICK_RESOLUTION, shas: [] });
      }
      const resolved = current.status === 'review'
        ? deps.move(id, 'done', { by: 'user', note: USER_CLICK_RESOLUTION })
        : current;
      notify();
      return resolved;
    },
    moveByUser(id: string, to: RequestStatus): RequestRecord {
      const input: MoveInput =
        to === 'doing' ? { by: 'workbench', note: 'claimed via the workbench board' }
        : to === 'review' ? { by: 'workbench', para: USER_CLICK_RESOLUTION, shas: [] }
        : to === 'done' ? { by: 'user', note: 'accepted by the user via the workbench board' }
        : { by: 'user', note: 'bounced by the user via the workbench board' }; // to 'new'
      const moved = deps.move(id, to, input);
      notify();
      return moved;
    },
    applyTags(id: string, tags: string[]): RequestRecord {
      const tagged = deps.tag(id, tags);
      notify();
      return tagged;
    },
    noteByUser(id: string, text: string): RequestRecord {
      const noted = deps.note(id, 'user', text);
      notify();
      return noted;
    },
    record(id: string): RequestRecord | null {
      return all().find((r) => r.id === id) ?? null;
    },
    selectedId: () => selected,
    select(id: string | null): void {
      selected = id;
      notify();
    },
    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    error: () => deps.error,
  };
}
