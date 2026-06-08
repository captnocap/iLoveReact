// requests.ts — the REQUEST LEDGER: user asks as durable, resolution-
// accountable records (REQLEDGER-0606, board model REQBOARD-0607).
// decisions.ts holds the user's RULINGS; this module holds the user's
// ASKS — verbatim — and what became of each one.
//
// Why it exists: git captures commits, not prompts. A user ask typed into a
// worker pane (or relayed by the supervisor) historically got lost or
// half-resolved with no trace. Every ask becomes one entry the oracle can
// serve, with a required resolution paragraph and the commit SHAs that
// implement it — the bridge from ask to git.
//
// THE BOARD (REQBOARD-0607): entries move through four states —
//   new → doing → review → done
// In the user's words: "so there are 4 states 1 new 2 in process 3 review
// 4 done". A worker CLAIMS (new→doing), works, and moves to review with the
// resolution paragraph + SHAs (doing→review — the resolve discipline lives
// at this edge). Only the USER (relayed through the supervisor as actor
// 'user') accepts review→done. The supervisor may bounce review→new (note
// required) or noise-close new→done (note required, NEVER from doing or
// review). done is terminal.
//
// Storage: one JSON file per entry, docs/game/_requests/req_<seq>.json —
// the V20 by-addition discipline applied to process. The SET is append-only
// (entries are only ever added, never deleted); an entry's ask is never
// rewritten; history is never rewritten — every transition and note APPENDS
// to the entry's `events` array. The `text` field is the user's words
// BYTE-VERBATIM: never paraphrased, never trimmed, never "cleaned up".
// Legacy two-state entries (status 'open'/'resolved') stay readable forever:
// parseEntry normalizes them on read ('open'→'new', 'resolved'→'done').
// Per-entry files keep parallel workers from clobbering each other's appends
// and give clean one-entry git diffs.
//
// Consumers: tools/request (the CLI, requestCli.ts), tools/oracle (the
// REQUEST LEDGER tier in oracle.ts), and human review (ask → paragraph →
// SHAs). Everything here takes the storage dir explicitly so tests run
// against a temp dir; defaultRequestsDir() resolves the real one.

declare const __fs_read: (path: string) => string | null;
declare const __fs_write: (path: string, content: string) => boolean;
declare const __fs_list_json: (path: string) => string;
declare const __fs_exists: (path: string) => boolean;
declare const process: { env: Record<string, string | null | undefined>; cwd(): string } | undefined;

export type RequestStatus = 'new' | 'doing' | 'review' | 'done';

/** Legacy two-state values normalized on read — old files stay readable forever. */
const LEGACY_STATUS: Record<string, RequestStatus> = { open: 'new', resolved: 'done' };
const STATUSES: RequestStatus[] = ['new', 'doing', 'review', 'done'];

/** 'hook' = auto-captured by the Claude Code UserPromptSubmit hook;
 *  'manual' (or absent) = a worker ran `tools/request log` by hand. */
export type CaptureMode = 'hook' | 'manual';

/** One append-only history line: a state transition or a free note. */
export type RequestEvent = {
  at: string;             // ISO timestamp of the event
  actor: string;          // who moved/noted: 'user', 'supervisor', a worker label
  kind: 'state' | 'note';
  from?: RequestStatus;   // state events only
  to?: RequestStatus;     // state events only
  text?: string;          // the note, or the paragraph/note riding a transition
};

export type RequestRecord = {
  id: string;             // 'req_0007'
  at: string;             // ISO timestamp of the ask
  origin: string;         // which pane/lane, 'supervisor-relay', or 'session:<id8>'
  text: string;           // the user's words, BYTE-VERBATIM
  status: RequestStatus;
  sessionId?: string;     // Claude session that received the ask (the report key)
  captureMode?: CaptureMode;
  events?: RequestEvent[]; // append-only history (absent on pre-board entries)
  tags?: string[];        // SECRETARY categories (REQSEC-0607) — organization ONLY
  resolvedAt?: string;    // ISO timestamp of the doing→review move
  resolution?: string;    // the paragraph: what was done, why, what changed
  shas?: string[];        // commit SHAs implementing it ([] = no-code resolution)
};

/** The paragraph bar: a real paragraph, not a commit-message one-liner. */
export const MIN_RESOLUTION_CHARS = 120;

const ENTRY_FILE_RE = /^req_(\d+)\.json$/;
const SHA_RE = /^[0-9a-f]{7,40}$/i;

/** docs/game/_requests under the repo root (RJIT_ROOT from the tools/
 *  wrappers; cwd fallback covers `rjit game verify` running at root). */
export function defaultRequestsDir(): string {
  const env = typeof process !== 'undefined' ? process.env.RJIT_ROOT : null;
  const root = (env ?? undefined) || (typeof process !== 'undefined' ? process.cwd() : '.');
  return `${root}/docs/game/_requests`;
}

function entryPath(dir: string, id: string): string {
  return `${dir}/${id}.json`;
}

function parseEntry(path: string): RequestRecord {
  const raw = __fs_read(path);
  if (raw === null) throw new Error(`unreadable ledger entry: ${path}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`corrupt ledger entry (bad JSON): ${path}`);
  }
  const r = parsed as RequestRecord;
  // normalize legacy statuses on read — old two-state files stay readable forever
  const normalized = LEGACY_STATUS[r.status as string];
  if (normalized) r.status = normalized;
  if (typeof r.id !== 'string' || typeof r.text !== 'string' || !STATUSES.includes(r.status)) {
    throw new Error(`corrupt ledger entry (missing fields): ${path}`);
  }
  return r;
}

/** Every entry, ascending by sequence. Missing dir = empty ledger. */
export function loadRequests(dir: string = defaultRequestsDir()): RequestRecord[] {
  const names: string[] = JSON.parse(__fs_list_json(dir));
  return names
    .filter((name) => ENTRY_FILE_RE.test(name))
    .sort((a, b) => seqOf(a) - seqOf(b))
    .map((name) => parseEntry(`${dir}/${name}`));
}

function seqOf(fileName: string): number {
  return parseInt(ENTRY_FILE_RE.exec(fileName)![1], 10);
}

function nextId(dir: string): string {
  const names: string[] = JSON.parse(__fs_list_json(dir));
  let max = 0;
  for (const name of names) {
    if (ENTRY_FILE_RE.test(name)) max = Math.max(max, seqOf(name));
  }
  return `req_${String(max + 1).padStart(4, '0')}`;
}

function writeEntry(dir: string, record: RequestRecord): void {
  const path = entryPath(dir, record.id);
  if (!__fs_write(path, JSON.stringify(record, null, 2) + '\n')) {
    throw new Error(`failed to write ledger entry: ${path}`);
  }
}

/** Log an ask. `text` is stored exactly as given — verbatim is the contract.
 *  Every entry lands in 'new' — the board's intake column. */
export function logRequest(
  dir: string, text: string, origin: string,
  extra?: { sessionId?: string; captureMode?: CaptureMode },
): RequestRecord {
  if (text.trim().length === 0) throw new Error('request text is empty — the ask must be the user\'s words, verbatim');
  if (origin.trim().length === 0) throw new Error('origin is required (which pane/lane, or supervisor-relay)');
  const record: RequestRecord = {
    id: nextId(dir),
    at: new Date().toISOString(),
    origin,
    text,
    status: 'new',
    ...(extra?.sessionId ? { sessionId: extra.sessionId } : {}),
    captureMode: extra?.captureMode ?? 'manual',
    events: [],
  };
  writeEntry(dir, record);
  return record;
}

// ── the board: transitions (REQBOARD-0607) ───────────────────────────────────

/** Which targets are even reachable from each state. done is terminal. */
const LEGAL_MOVES: Record<RequestStatus, RequestStatus[]> = {
  new: ['doing', 'done'],
  doing: ['review'],
  review: ['done', 'new'],
  done: [],
};

function legalMovesLabel(from: RequestStatus): string {
  const targets = LEGAL_MOVES[from];
  if (targets.length === 0) return `${from} is terminal — no moves out, ever`;
  return `legal from ${from}: ${targets.map((t) => `${from}→${t}`).join(', ')}`;
}

export type MoveInput = {
  by: string;       // the actor: 'user', 'supervisor', or a worker label
  para?: string;    // doing→review: the resolution paragraph
  shas?: string[];  // doing→review: implementing commits ([] = no-code)
  note?: string;    // review→new bounce / new→done noise-close: why
};

/** THE transition function — every state change goes through here.
 *
 *  new→doing      worker claims; any actor.
 *  doing→review   REQUIRES para ≥ MIN_RESOLUTION_CHARS + shas (the resolve
 *                 discipline lives at this edge). resolution/shas/resolvedAt
 *                 fill exactly once, never rewritten — a re-review after a
 *                 bounce keeps the original fields and carries the new
 *                 paragraph on the transition event instead.
 *  review→done    acceptance — ONLY actor 'user' (the supervisor relays the
 *                 user's word).
 *  review→new     bounce back for rework; note required.
 *  new→done       supervisor-only noise-close for triage; note required.
 *                 NEVER available from doing or review.
 *  done           terminal.
 *
 *  Everything else is rejected with a message naming the legal moves. */
export function moveRequest(dir: string, id: string, to: RequestStatus, input: MoveInput): RequestRecord {
  const path = entryPath(dir, id);
  if (!__fs_exists(path)) throw new Error(`no such request: ${id}`);
  if (!STATUSES.includes(to)) throw new Error(`not a board state: ${JSON.stringify(to)} (new | doing | review | done)`);
  if (!input.by || input.by.trim().length === 0) throw new Error('--by is required: who is moving this (user, supervisor, or a worker label)');
  const record = parseEntry(path);
  const from = record.status;

  if (!LEGAL_MOVES[from].includes(to)) {
    throw new Error(`illegal move ${from}→${to} for ${id}; ${legalMovesLabel(from)}`);
  }

  const actor = input.by.trim();
  let eventText: string | undefined;
  const updated: RequestRecord = { ...record };

  if (from === 'doing' && to === 'review') {
    const para = input.para ?? '';
    if (para.trim().length < MIN_RESOLUTION_CHARS) {
      throw new Error(`doing→review demands the resolution paragraph (≥${MIN_RESOLUTION_CHARS} chars): what was done, why, what changed`);
    }
    if (input.shas === undefined) {
      throw new Error('doing→review demands --shas (the implementing commits, or "none" for a no-code resolution)');
    }
    for (const sha of input.shas) {
      if (!SHA_RE.test(sha)) throw new Error(`not a commit SHA: ${JSON.stringify(sha)} (7–40 hex chars; use --shas none for no-code resolutions)`);
    }
    if (updated.resolution === undefined) {
      // fill exactly once — done is acceptance only, these never change again
      updated.resolution = para;
      updated.shas = input.shas;
      updated.resolvedAt = new Date().toISOString();
    } else {
      // post-bounce re-review: original fields stand; the fresh paragraph
      // rides the transition event (history appends, never rewrites)
      eventText = para;
    }
  } else if (from === 'review' && to === 'done') {
    if (actor !== 'user') {
      throw new Error(`review→done is the USER's acceptance — only actor 'user' may flip it (got ${JSON.stringify(actor)}); the supervisor relays the user's word`);
    }
    if (input.note) eventText = input.note;
  } else if (from === 'review' && to === 'new') {
    if (!input.note || input.note.trim().length === 0) {
      throw new Error('review→new is a bounce — --note is required: what was wrong, what rework is expected');
    }
    eventText = input.note;
  } else if (from === 'new' && to === 'done') {
    if (actor !== 'supervisor') {
      throw new Error(`new→done is the supervisor's noise-close (got ${JSON.stringify(actor)}) — workers claim with move ${id} doing instead`);
    }
    if (!input.note || input.note.trim().length === 0) {
      throw new Error('new→done is a noise-close — --note is required: why this is not a job');
    }
    eventText = input.note;
  } else if (from === 'new' && to === 'doing') {
    if (input.note) eventText = input.note;
  }

  updated.status = to;
  updated.events = [...(record.events ?? []), {
    at: new Date().toISOString(),
    actor,
    kind: 'state',
    from,
    to,
    ...(eventText !== undefined ? { text: eventText } : {}),
  }];
  writeEntry(dir, updated);
  return updated;
}

/** Append a free note to an entry's history. Notes never change state and
 *  are welcome in any state — done entries can still gather annotations. */
export function noteRequest(dir: string, id: string, by: string, text: string): RequestRecord {
  const path = entryPath(dir, id);
  if (!__fs_exists(path)) throw new Error(`no such request: ${id}`);
  if (!by || by.trim().length === 0) throw new Error('--by is required: who is noting this');
  if (text.trim().length === 0) throw new Error('note text is empty');
  const record = parseEntry(path);
  const updated: RequestRecord = {
    ...record,
    events: [...(record.events ?? []), { at: new Date().toISOString(), actor: by.trim(), kind: 'note', text }],
  };
  writeEntry(dir, updated);
  return updated;
}

// ── the SECRETARY: tags (REQSEC-0607) ────────────────────────────────────────
//
// USER ASK, verbatim: "we can use the useAssistant hook and hit a model who
// can evaluate and categorize and all that jazz. since the mix of them is a
// shit show. something like tags or whatever, that way can search by tag or
// etc. and if model doesnt know they dont do nada. but would keep it far
// more organized and can do it for free effectively and that way, we keep
// the hook on all the same, nothing changes, we just have a secretary".
//
// Tags are ORGANIZATION ONLY: they never touch status, the resolution
// discipline, or the user-only done gate. The model proposes; this door
// persists. Unsure model → no call → entry untouched. The tag set on an
// entry is append-only (union — tags are added, never removed).

/** The seed vocabulary the secretary starts from — the model may extend it. */
export const SEED_TAGS = ['bug', 'perf-log', 'ask', 'ruling', 'ux', 'idea'];

/** A sane tag: short, lowercase kebab. Anything else from the model is
 *  dropped silently — "if model doesnt know they dont do nada". */
const TAG_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;

export function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const candidate of raw) {
    if (typeof candidate !== 'string') continue;
    const tag = candidate.trim().toLowerCase();
    if (TAG_RE.test(tag) && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/** Tag an entry — the ONE persistence door for the secretary (and the CLI).
 *  Union with the existing set; nothing valid to add = a no-op that returns
 *  the record untouched (never an error). Tags never change anything else. */
export function tagRequest(dir: string, id: string, tags: string[]): RequestRecord {
  const path = entryPath(dir, id);
  if (!__fs_exists(path)) throw new Error(`no such request: ${id}`);
  const record = parseEntry(path);
  const incoming = normalizeTags(tags);
  const existing = record.tags ?? [];
  const added = incoming.filter((tag) => !existing.includes(tag));
  if (added.length === 0) return record; // unsure / nothing new → untouched
  const updated: RequestRecord = { ...record, tags: [...existing, ...added] };
  writeEntry(dir, updated);
  return updated;
}

/** The search fold: entries carrying a tag (used by `board --tag` /
 *  `list --tag` and the workbench tag views). */
export function filterByTag(records: RequestRecord[], tag: string): RequestRecord[] {
  const needle = tag.trim().toLowerCase();
  return records.filter((record) => (record.tags ?? []).includes(needle));
}

/** Every tag in use, sorted — the rail chips and the CLI's tag listing. */
export function allTags(records: RequestRecord[]): string[] {
  const seen = new Set<string>();
  for (const record of records) for (const tag of record.tags ?? []) seen.add(tag);
  return Array.from(seen).sort();
}

/** The board fold: the four columns, DISPATCH-EXEMPT by default. Supervisor
 *  dispatches (origin 'supervisor-dispatch') are durable records, never jobs
 *  — their markers track resolution — so they are EXCLUDED from every column
 *  unless explicitly asked for (USER FINDING REQBOARD-0607: "i see a ton of
 *  them as 'dispatches' marked as new but then only 13 of them in
 *  unresolved? is that correct." — the columns must agree with the true
 *  open-asks set, the old list --open filter). */
export function boardColumns(records: RequestRecord[], includeDispatches = false): Record<RequestStatus, RequestRecord[]> {
  const columns: Record<RequestStatus, RequestRecord[]> = { new: [], doing: [], review: [], done: [] };
  for (const record of records) {
    if (!includeDispatches && record.origin === DISPATCH_ORIGIN) continue;
    columns[record.status].push(record);
  }
  return columns;
}

/** The worker habit `resolve <id> --para --shas` survives as doing→review.
 *  Work lands in REVIEW, not done — only the user accepts review→done. */
export function resolveRequest(dir: string, id: string, paragraph: string, shas: string[], by = 'worker'): RequestRecord {
  return moveRequest(dir, id, 'review', { by, para: paragraph, shas });
}

/** One-shot migration: rewrite every entry's LEGACY status to the mapped
 *  board value on disk ('open'→'new', 'resolved'→'done'). Idempotent —
 *  already-board files are untouched; nothing but the status field changes. */
export function migrateBoard(dir: string = defaultRequestsDir()): { migrated: number; untouched: number; opens: number; resolveds: number } {
  const names: string[] = JSON.parse(__fs_list_json(dir));
  let migrated = 0, untouched = 0, opens = 0, resolveds = 0;
  for (const name of names.filter((n) => ENTRY_FILE_RE.test(n)).sort((a, b) => seqOf(a) - seqOf(b))) {
    const path = `${dir}/${name}`;
    const raw = __fs_read(path);
    if (raw === null) throw new Error(`unreadable ledger entry: ${path}`);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const mapped = LEGACY_STATUS[parsed.status as string];
    if (!mapped) { untouched += 1; continue; }
    if (parsed.status === 'open') opens += 1; else resolveds += 1;
    parsed.status = mapped;
    if (!__fs_write(path, JSON.stringify(parsed, null, 2) + '\n')) {
      throw new Error(`failed to write ledger entry: ${path}`);
    }
    migrated += 1;
  }
  return { migrated, untouched, opens, resolveds };
}

// ── hook auto-capture (REQLEDGER-0606; blanket capture RESTORED by
//    REQSEC-0607 — the secretary amendment) ──────────────────────────────────
//
// The Claude Code UserPromptSubmit hook pipes its JSON payload through
// tools/request-hook-prompt → `request hook-prompt`, which calls
// hookCapturePrompt with the LITERAL prompt + session_id. Zero paraphrasing,
// zero worker cooperation. The Stop hook (`request hook-stop`) reminds the
// session about entries it holds in 'doing' so claimed work gets moved to
// review before the turn cycle ends.
//
// CAPTURE IS BLANKET (REQSEC-0607 — the user's words: "we keep the hook on
// all the same, nothing changes, we just have a secretary"). Every
// substantive prompt is captured, with only the original noise rule
// (trivial acks + minPromptChars + slash/shell/memory commands skipped).
// The marker-only capture REQBOARD-0607 briefly introduced is REMOVED.
// Organization is the SECRETARY's job (tags, below), not the capture
// gate's. Supervisor dispatches (dispatchPrefixes) capture as origin
// 'supervisor-dispatch' — exempt from the board flow as ever.

export type StopReminderMode =
  | 'block-once'  // Stop hook nudges the worker once per turn cycle (default)
  | 'context'     // transcript-only note, never interrupts
  | 'off';

/** The secretary's model prompts begin with this EXACT string. The capture
 *  hook must NEVER ledger them — the app's claude_code workers run in this
 *  cwd, so the repo's UserPromptSubmit hook fires on THEIR prompts too, and
 *  blanket-capturing the secretary's own prompt is an infinite feedback
 *  loop: prompt → captured → untagged → batched into the next prompt →
 *  captured … (USER FINDING REQSEC-0607: "infinite loop of this incoming"). */
export const SECRETARY_PROMPT_PREFIX = 'You are the request-ledger SECRETARY.';

export type LedgerConfig = {
  /** Hook captures shorter than this (trimmed) are noise, not asks. */
  minPromptChars: number;
  /** Case-insensitive regex of trivial acks the hook never logs. */
  ackPattern: string;
  stopReminder: StopReminderMode;
  /** Prompts starting with one of these (exact case) are supervisor
   *  dispatches: still captured (the durable record is welcome), but with
   *  origin 'supervisor-dispatch' — exempt from the Stop-hook nudge and the
   *  board flow, hidden from `list --open` unless --all. The dispatch
   *  markers (XYZ-0606) already track their resolution. */
  dispatchPrefixes: string[];
  /** Prompts starting with one of these are MACHINE-GENERATED (the app's
   *  own claude_code workers, handoff briefs, viewer preambles) — never
   *  user asks, never captured. The anti-feedback-loop list. */
  machinePrefixes: string[];
};

export const DEFAULT_LEDGER_CONFIG: LedgerConfig = {
  minPromptChars: 40,
  ackPattern: '^(ok(ay)?|yes|no|nah|yep|k|sure|go( ahead)?|continue|proceed|do it|stop|wait|thanks?|ty|lgtm|good( work)?|nice|approved?)\\b.{0,20}$',
  stopReminder: 'block-once',
  dispatchPrefixes: ['SUPERVISOR'],
  machinePrefixes: [
    SECRETARY_PROMPT_PREFIX,
    '---\nhandoff_version:',                     // /hand-over briefs resumed in a pane (YAML frontmatter)
    '--- handoff_version:',                      // …and the flattened single-line variant
    'You drive a live, hot-reloaded 3D viewer',  // assist3d's claude preamble
  ],
};

/** The origin marking a captured supervisor dispatch — the exemption key. */
export const DISPATCH_ORIGIN = 'supervisor-dispatch';

/** _config.json in the requests dir overrides the defaults, key by key. */
export function loadLedgerConfig(dir: string = defaultRequestsDir()): LedgerConfig {
  const raw = __fs_read(`${dir}/_config.json`);
  if (raw === null) return DEFAULT_LEDGER_CONFIG;
  let parsed: Partial<LedgerConfig>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`corrupt ledger config (bad JSON): ${dir}/_config.json`);
  }
  return { ...DEFAULT_LEDGER_CONFIG, ...parsed };
}

export type HookCaptureResult =
  | { action: 'logged'; record: RequestRecord }
  | { action: 'skipped'; reason: string };

/** The UserPromptSubmit path: decide noise-vs-ask, then log VERBATIM —
 *  blanket capture restored by REQSEC-0607 ("we keep the hook on all the
 *  same, nothing changes, we just have a secretary").
 *  `originLabel` names the capturing CLI in the origin field — 'session'
 *  (Claude, the original vocabulary) or 'codex'; both CLIs send the same
 *  payload shape, so this is the only per-CLI divergence on capture. */
export function hookCapturePrompt(
  dir: string, sessionId: string, prompt: string,
  config: LedgerConfig = loadLedgerConfig(dir),
  originLabel: string = 'session',
): HookCaptureResult {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return { action: 'skipped', reason: 'empty prompt' };
  // the anti-feedback-loop gate FIRST: the app's own claude_code workers run
  // in this cwd, so this hook fires on their prompts too — capturing the
  // secretary's prompt feeds it back into the secretary's next batch, forever
  if (config.machinePrefixes.some((prefix) => trimmed.startsWith(prefix))) {
    return { action: 'skipped', reason: 'machine-generated worker prompt (machinePrefixes), not a user ask' };
  }
  if (/^[/!#]/.test(trimmed)) return { action: 'skipped', reason: 'slash/shell/memory command, not an ask' };
  if (new RegExp(config.ackPattern, 'i').test(trimmed)) return { action: 'skipped', reason: 'trivial ack (ackPattern)' };
  if (trimmed.length < config.minPromptChars) return { action: 'skipped', reason: `under minPromptChars (${config.minPromptChars})` };
  const isDispatch = config.dispatchPrefixes.some((prefix) => trimmed.startsWith(prefix));
  const record = logRequest(dir, prompt, isDispatch ? DISPATCH_ORIGIN : `${originLabel}:${sessionId.slice(0, 8)}`, {
    sessionId, captureMode: 'hook',
  });
  return { action: 'logged', record };
}

/** Amend a mis-captured entry to supervisor-dispatch — a field-fill on
 *  origin only (the ask text and timestamps are untouched; done entries
 *  keep their record as-is and can't be amended). */
export function markDispatch(dir: string, id: string): RequestRecord {
  const path = `${dir}/${id}.json`;
  if (!__fs_exists(path)) throw new Error(`no such request: ${id}`);
  const record = parseEntry(path);
  if (record.status === 'done') throw new Error(`${id} is already done — its record stands as-is`);
  if (record.origin === DISPATCH_ORIGIN) return record;
  const amended: RequestRecord = { ...record, origin: DISPATCH_ORIGIN };
  writeEntry(dir, amended);
  return amended;
}

/** The Stop-hook scan + the `list --session` group: a session's entries. */
export function requestsForSession(dir: string, sessionId: string): RequestRecord[] {
  return loadRequests(dir).filter((record) => record.sessionId === sessionId);
}
