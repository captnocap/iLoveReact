// editors/workbench/requests/panel.ts — the REQUEST BOARD source's headless
// half (REQPANEL-0606 → REQBOARD-0607 → REQSEC-0607): the view roster (+ tag
// chips), the LIST PanelSpec, the DETAIL spec, and the stage's row folds.
// No React (the characters.test.ts bundling law).
//
// MASTER-DETAIL, the right way around (USER VERDICT, verbatim: "i would have
// thought you put the list of asks in the area where the request data is xD
// but maybe im wrong" — they were right): column 3 (narrow) is the LIST of
// asks — truncated rows are fine there, that's what a list is for — and the
// WIDE stage carries the selected request's FULL data: ask verbatim,
// resolution, events/notes, and the board verbs, with room to breathe.
// Filters (the views + tag chips) stay on the rail.

import type { FieldSpec, PanelSpec } from '../../../shell/fields';
import type { ActionSpec, RosterRow } from '../../../shell/Workbench';
import { DISPATCH_ORIGIN, type RequestEvent, type RequestRecord, type RequestStatus } from '../../../../../docs/game/_index/requests';
import { REQUESTS_VIEWS, type RequestsStore, type RequestsView } from './store';

/** roster = the fixed views + a #chip per tag in use (REQSEC-0607: "search
 *  by tag" is selecting a chip). */
export function requestsRoster(store: RequestsStore): RosterRow[] {
  const counts = store.counts();
  const fixed = REQUESTS_VIEWS.map((v) => ({ id: v.id, label: `${v.label} · ${counts[v.id] ?? 0}` }));
  const tags = store.tagsInUse().map((tag) => ({ id: `tag:${tag}`, label: `#${tag} · ${counts[`tag:${tag}`] ?? 0}` }));
  return [...fixed, ...tags];
}

/** stamp → 'YYYY-MM-DD HH:MM' (the list/panel date) */
export function shortStamp(at: string): string {
  return at.length >= 16 ? `${at.slice(0, 10)} ${at.slice(11, 16)}` : at;
}

/** the row line: the ask's first line, tightly capped */
export function askPreview(text: string, cap = 96): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > cap ? `${line.slice(0, cap - 1)}…` : line;
}

/** the CARD body: the first few lines of REAL, wrapping text — never a
 *  one-line ellipsis. USER VERDICT (REQBOARD-0607), verbatim: "every single
 *  one of them is an elipsis and so i cant read jack shit". A card must show
 *  enough of the ask to recognize the job. */
export function cardPreview(text: string, capChars = 240, capLines = 4): string {
  const allLines = text.trim().split('\n');
  let body = allLines.slice(0, capLines).join('\n');
  let truncated = allLines.length > capLines;
  if (body.length > capChars) {
    body = body.slice(0, capChars - 1);
    truncated = true;
  }
  return truncated ? `${body}…` : body;
}

// ── the stage fold (display only) ────────────────────────────────────────────

export type RequestRowView = {
  id: string;
  stamp: string;
  origin: string;
  status: RequestStatus;
  preview: string;
  /** the card body — first few lines of REAL text, made to wrap */
  cardText: string;
  tags: string[];
  selected: boolean;
};

export function requestRows(store: RequestsStore, view: RequestsView): RequestRowView[] {
  const selected = store.selectedId();
  return store.rowsFor(view).map((r: RequestRecord) => ({
    id: r.id,
    stamp: shortStamp(r.at),
    origin: r.origin,
    status: r.status,
    preview: askPreview(r.text),
    cardText: cardPreview(r.text),
    tags: r.tags ?? [],
    selected: r.id === selected,
  }));
}

// ── the board sections (four sections, user-approved) ────────────────────────

export type BoardSectionView = { status: RequestStatus; title: string; rows: RequestRowView[] };

const BOARD_ORDER: RequestStatus[] = ['new', 'doing', 'review', 'done'];

/** Group a view's rows into board sections. Which sections a view shows:
 *  unresolved → new/doing/review (what is left), resolved → done,
 *  all / dispatches / tag:* → all four. Dispatches stay off every non-
 *  dispatch view (rowsFor hides them — the board shows JOBS). */
export function boardSections(store: RequestsStore, view: RequestsView): BoardSectionView[] {
  const statuses: RequestStatus[] = view === 'resolved' ? ['done']
    : view === 'unresolved' ? ['new', 'doing', 'review']
    : BOARD_ORDER;
  const sourceView: RequestsView = view === 'unresolved' || view === 'resolved' ? 'all' : view;
  const rows = requestRows(store, sourceView);
  return statuses.map((status) => ({
    status,
    title: status.toUpperCase(),
    rows: rows.filter((r) => r.status === status),
  }));
}

// ── column 3: THE LIST (the master side of master-detail) ────────────────────

const LIST_PREVIEW_CAP = 44;

/** The list panel: board sections as groups, one act-row per ask — clicking
 *  a row SELECTS it (selection is view state, never an edit). Truncation is
 *  welcome HERE; the full text lives in the wide detail. */
export function requestsPanel(store: RequestsStore, view: RequestsView): PanelSpec {
  const groups: PanelSpec['groups'] = [];
  if (store.error()) {
    groups.push({ title: 'LEDGER', fields: [{ k: 'ledger', t: 'val', get: () => `unavailable: ${store.error()}` }], layout: 'rows' });
  }
  let total = 0;
  for (const section of boardSections(store, view)) {
    total += section.rows.length;
    if (section.rows.length === 0) continue; // empty sections cost rail space
    const fields: FieldSpec[] = section.rows.map((r) => ({
      k: `${r.selected ? '▶ ' : ''}${r.id} · ${askPreview(r.preview, LIST_PREVIEW_CAP)}`,
      t: 'act',
      tone: r.selected ? 'primary' : undefined,
      run: () => { store.select(r.selected ? null : r.id); },
    }));
    groups.push({ title: `${section.title} · ${section.rows.length}`, fields, layout: 'rows' });
  }
  if (total === 0) {
    groups.push({
      title: 'REQUESTS',
      fields: [{ k: 'empty', t: 'val', get: () => (view === 'unresolved' ? 'nothing left unresolved — the board is clean' : 'no entries in this view') }],
      layout: 'rows',
    });
  }
  return { groups };
}

// ── the wide stage: THE DETAIL (headless spec; RequestList.tsx renders it) ───

export type DetailVerb = { k: string; tone: string; run(): void };

export type RequestDetail = {
  record: RequestRecord | null;
  hint: string | null;       // no selection / broken ledger
  stamp: string;             // shortStamp(at) when selected
  verbs: DetailVerb[];       // the BOARD MOVES legal from this state (jobs only)
  terminal: string | null;   // the done note
  events: RequestEvent[];
};

/** The selected request's full data — ask verbatim, resolution, history, and
 *  the board verbs (REQBOARD-0607: 'mark resolved' vocabulary is dead;
 *  review→done stays user-gated — the panel IS the user, accept moves as
 *  actor 'user'; dispatches are records, not jobs — no verbs at all). */
export function requestDetail(store: RequestsStore): RequestDetail {
  const id = store.selectedId();
  const record = id ? store.record(id) : null;
  if (!record) {
    return {
      record: null,
      hint: store.error() ? `ledger unavailable: ${store.error()}` : 'click an ask in the list',
      stamp: '', verbs: [], terminal: null, events: [],
    };
  }
  const verbs: DetailVerb[] = [];
  let terminal: string | null = null;
  const isJob = record.origin !== DISPATCH_ORIGIN;
  if (isJob && record.status === 'new') {
    verbs.push({ k: 'claim → doing', tone: 'accent', run: () => { store.moveByUser(record.id, 'doing'); } });
  } else if (isJob && record.status === 'doing') {
    verbs.push({ k: 'finish → review', tone: 'info', run: () => { store.moveByUser(record.id, 'review'); } });
  } else if (isJob && record.status === 'review') {
    verbs.push(
      { k: '✓ accept → done', tone: 'success', run: () => { store.moveByUser(record.id, 'done'); } },
      { k: '↩ bounce → new', tone: 'warning', run: () => { store.moveByUser(record.id, 'new'); } },
    );
  } else if (record.status === 'done') {
    // done is terminal (by-addition law) — surfaced, never worked around
    terminal = 'done is terminal — log a new request instead';
  }
  return { record, hint: null, stamp: shortStamp(record.at), verbs, terminal, events: record.events ?? [] };
}

/** the hero bar mirrors the detail's NEXT legal move — one tap from anywhere */
export function requestsActions(store: RequestsStore, _view: RequestsView): ActionSpec[] {
  const id = store.selectedId();
  const record = id ? store.record(id) : null;
  if (!record || record.status === 'done' || record.origin === DISPATCH_ORIGIN) return [];
  if (record.status === 'new') return [{ id: 'claim', label: '→ doing', icon: 'ListChecks', run: () => { store.moveByUser(record.id, 'doing'); } }];
  if (record.status === 'doing') return [{ id: 'review', label: '→ review', icon: 'ListChecks', run: () => { store.moveByUser(record.id, 'review'); } }];
  return [{ id: 'accept', label: '✓ done', icon: 'ListChecks', run: () => { store.moveByUser(record.id, 'done'); } }];
}
