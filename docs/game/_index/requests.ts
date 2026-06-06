// requests.ts — the REQUEST LEDGER: user asks as durable, resolution-
// accountable records (REQLEDGER-0606). decisions.ts holds the user's
// RULINGS; this module holds the user's ASKS — verbatim — and what became
// of each one.
//
// Why it exists: git captures commits, not prompts. A user ask typed into a
// worker pane (or relayed by the supervisor) historically got lost or
// half-resolved with no trace. Every ask becomes one entry the oracle can
// serve, with a required resolution paragraph and the commit SHAs that
// implement it — the bridge from ask to git.
//
// Storage: one JSON file per entry, docs/game/_requests/req_<seq>.json —
// the V20 by-addition discipline applied to process. The SET is append-only
// (entries are only ever added, never deleted); an entry's ask is never
// rewritten — resolution is a field-fill (status flips open → resolved,
// the empty resolution fields get filled ONCE). The `text` field is the
// user's words BYTE-VERBATIM: never paraphrased, never trimmed, never
// "cleaned up". Per-entry files keep parallel workers from clobbering each
// other's appends and give clean one-entry git diffs.
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

export type RequestStatus = 'open' | 'resolved';

/** 'hook' = auto-captured by the Claude Code UserPromptSubmit hook;
 *  'manual' (or absent) = a worker ran `tools/request log` by hand. */
export type CaptureMode = 'hook' | 'manual';

export type RequestRecord = {
  id: string;            // 'req_0007'
  at: string;            // ISO timestamp of the ask
  origin: string;        // which pane/lane, 'supervisor-relay', or 'session:<id8>'
  text: string;          // the user's words, BYTE-VERBATIM
  status: RequestStatus;
  sessionId?: string;    // Claude session that received the ask (the report key)
  captureMode?: CaptureMode;
  resolvedAt?: string;   // ISO timestamp of the resolution
  resolution?: string;   // the paragraph: what was done, why, what changed
  shas?: string[];       // commit SHAs implementing it ([] = no-code resolution)
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
  if (typeof r.id !== 'string' || typeof r.text !== 'string' || (r.status !== 'open' && r.status !== 'resolved')) {
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

/** Log an ask. `text` is stored exactly as given — verbatim is the contract. */
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
    status: 'open',
    ...(extra?.sessionId ? { sessionId: extra.sessionId } : {}),
    captureMode: extra?.captureMode ?? 'manual',
  };
  writeEntry(dir, record);
  return record;
}

// ── hook auto-capture (REQLEDGER-0606 addendum) ──────────────────────────────
//
// The Claude Code UserPromptSubmit hook pipes its JSON payload through
// tools/request-hook-prompt → `request hook-prompt`, which calls
// hookCapturePrompt with the LITERAL prompt + session_id. Zero paraphrasing,
// zero worker cooperation. The Stop hook (`request hook-stop`) reminds the
// session about its unresolved captures so the resolution paragraph gets
// written before the turn cycle ends.
//
// The necessary-vs-noise rule (which prompts the hook logs at all) is P2
// data, not a buried constant: docs/game/_requests/_config.json overrides
// DEFAULT_LEDGER_CONFIG. Trivial acks and slash/shell/memory commands are
// never logged (cleaner than logging + auto-closing them); everything
// substantive is.

export type StopReminderMode =
  | 'block-once'  // Stop hook nudges the worker once per turn cycle (default)
  | 'context'     // transcript-only note, never interrupts
  | 'off';

export type LedgerConfig = {
  /** Hook captures shorter than this (trimmed) are noise, not asks. */
  minPromptChars: number;
  /** Case-insensitive regex of trivial acks the hook never logs. */
  ackPattern: string;
  stopReminder: StopReminderMode;
};

export const DEFAULT_LEDGER_CONFIG: LedgerConfig = {
  minPromptChars: 40,
  ackPattern: '^(ok(ay)?|yes|no|nah|yep|k|sure|go( ahead)?|continue|proceed|do it|stop|wait|thanks?|ty|lgtm|good( work)?|nice|approved?)\\b.{0,20}$',
  stopReminder: 'block-once',
};

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

/** The UserPromptSubmit path: decide noise-vs-ask, then log VERBATIM. */
export function hookCapturePrompt(
  dir: string, sessionId: string, prompt: string,
  config: LedgerConfig = loadLedgerConfig(dir),
): HookCaptureResult {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return { action: 'skipped', reason: 'empty prompt' };
  if (/^[/!#]/.test(trimmed)) return { action: 'skipped', reason: 'slash/shell/memory command, not an ask' };
  if (new RegExp(config.ackPattern, 'i').test(trimmed)) return { action: 'skipped', reason: 'trivial ack (ackPattern)' };
  if (trimmed.length < config.minPromptChars) return { action: 'skipped', reason: `under minPromptChars (${config.minPromptChars})` };
  const record = logRequest(dir, prompt, `session:${sessionId.slice(0, 8)}`, {
    sessionId, captureMode: 'hook',
  });
  return { action: 'logged', record };
}

/** The Stop-hook scan + the `list --session` group: a session's entries. */
export function requestsForSession(dir: string, sessionId: string): RequestRecord[] {
  return loadRequests(dir).filter((record) => record.sessionId === sessionId);
}

/** Close an ask: the ONE field-fill an entry ever gets. The original ask
 *  fields are untouched; double-resolution is rejected (by-addition law). */
export function resolveRequest(dir: string, id: string, paragraph: string, shas: string[]): RequestRecord {
  const path = entryPath(dir, id);
  if (!__fs_exists(path)) throw new Error(`no such request: ${id}`);
  const record = parseEntry(path);
  if (record.status === 'resolved') {
    throw new Error(`${id} is already resolved — entries are never rewritten; log a new request instead`);
  }
  if (paragraph.trim().length < MIN_RESOLUTION_CHARS) {
    throw new Error(`resolution must be a real paragraph (≥${MIN_RESOLUTION_CHARS} chars): what was done, why, what changed`);
  }
  for (const sha of shas) {
    if (!SHA_RE.test(sha)) throw new Error(`not a commit SHA: ${JSON.stringify(sha)} (7–40 hex chars; use --shas none for no-code resolutions)`);
  }
  const resolved: RequestRecord = {
    ...record,
    status: 'resolved',
    resolvedAt: new Date().toISOString(),
    resolution: paragraph,
    shas,
  };
  writeEntry(dir, resolved);
  return resolved;
}
