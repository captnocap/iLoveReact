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

export type RequestRecord = {
  id: string;            // 'req_0007'
  at: string;            // ISO timestamp of the ask
  origin: string;        // which pane/lane, or 'supervisor-relay'
  text: string;          // the user's words, BYTE-VERBATIM
  status: RequestStatus;
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
export function logRequest(dir: string, text: string, origin: string): RequestRecord {
  if (text.trim().length === 0) throw new Error('request text is empty — the ask must be the user\'s words, verbatim');
  if (origin.trim().length === 0) throw new Error('origin is required (which pane/lane, or supervisor-relay)');
  const record: RequestRecord = {
    id: nextId(dir),
    at: new Date().toISOString(),
    origin,
    text,
    status: 'open',
  };
  writeEntry(dir, record);
  return record;
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
