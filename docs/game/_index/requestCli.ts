// requestCli.ts — `tools/request`: the REQUEST LEDGER CLI (REQLEDGER-0606,
// board model REQBOARD-0607).
//
//   tools/request board [--since <ISO>]
//   tools/request log "<the user's words, VERBATIM>" --origin <pane|lane|supervisor-relay>
//   tools/request move <id> <new|doing|review|done> --by <actor> [--para "..."] [--shas sha,sha|none] [--note "..."]
//   tools/request note <id> --by <actor> "text"
//   tools/request resolve <id> --para "<paragraph>" --shas <sha,sha|none>   (alias: move <id> review)
//   tools/request list [--open]
//   tools/request show <id>
//   tools/request migrate-board
//
// Storage + validation live in requests.ts (the deep module); this file is
// argv parsing and printing only. Runs under tools/v8cli via the tools/request
// wrapper, which exports RJIT_ROOT so the ledger dir resolves from anywhere.

import {
  defaultRequestsDir, loadRequests, logRequest, resolveRequest,
  moveRequest, noteRequest, migrateBoard, boardColumns,
  tagRequest, filterByTag, allTags,
  hookCapturePrompt, requestsForSession, loadLedgerConfig,
  markDispatch, DISPATCH_ORIGIN, markOneOff, isOffBoard,
  type RequestRecord, type RequestStatus, type RequestEvent,
} from './requests';

declare const __readStdin: () => string;
declare const __sleepMs: (ms: number) => void;
declare const __termSize: () => string; // JSON [cols, rows]; [0,0] when stdin isn't a tty
declare const process: { argv: string[]; exit(code: number): void };

const USAGE = `request — the REQUEST LEDGER job board (new → doing → review → done; docs/game/REQUESTS.md)

  request board [--since <ISO>] [--all] [--tag <tag>]
      the four columns (off-board-exempt — dispatches + one-offs are records,
      not jobs; --all includes them); --since appends the ACTIVITY log;
      --tag filters to one tag
  request log "<verbatim ask>" --origin <pane|lane|supervisor-relay> [--session <id>]
  request move <id> <new|doing|review|done> --by <actor> [--para "<paragraph>"] [--shas <sha,sha|none>] [--note "<why>"]
      new→doing worker claims · doing→review needs --para + --shas · review→done USER ONLY
      review→new bounce (--note) · new→done supervisor noise-close (--note) · done is terminal
  request note <id> --by <actor> "<text>"
  request tag <id> <tag,tag,...>       the SECRETARY door: union onto the entry's tags
      (organization ONLY — never touches state/resolution; bad tags dropped silently)
  request resolve <id> --para "<paragraph>" --shas <sha,sha|none> [--by <actor>]
      ⚠ resolve is now an ALIAS for \`move <id> review\` — your work lands in
      REVIEW, NOT done. Only the user (via the supervisor) flips review→done.
      (paragraph also accepted on stdin)
  request list [--open] [--all] [--session <id>] [--tag <tag>]
      (--open = everything not done; hides dispatches + one-offs unless --all)
  request tags                         every tag in use, with counts
  request show <id>
  request migrate-board                one-shot: legacy open→new, resolved→done (idempotent)
  request mark-dispatch <id>           amend a mis-captured entry to supervisor-dispatch
  request oneoff <id> --by <actor>     REQSCOPE-0705 scope gate: the ask is UNRELATED to the
      editor/game building — drop it off the board as a one-off (the record
      stays durable and oracle-served; the board, list --open, and the stop
      nudge stop carrying it)

hook mode (wired by .claude/settings.json + .codex/hooks.json; payload JSON on stdin):
  request hook-prompt [--cli codex]   UserPromptSubmit → blanket-capture the literal prompt
                                      (only trivial acks / short prompts / slash-shell skipped);
                                      the context line asks the session to SCOPE-GATE:
                                      editor/game work → claim; unrelated → oneoff
  request hook-stop   [--cli codex]   Stop → remind the session of entries it holds in doing`;

function fail(message: string, code = 1): never {
  console.error(`request: ${message}`);
  process.exit(code);
  throw new Error('unreachable');
}

// ── argv: positionals + --flags (every flag takes one value) ─────────────────

function parseArgs(argv: string[]): { positionals: string[]; flags: Map<string, string> } {
  const positionals: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--open') { flags.set('open', 'true'); continue; }
    if (arg === '--all') { flags.set('all', 'true'); continue; }
    if (arg.startsWith('--')) {
      const value = argv[i + 1];
      if (value === undefined) fail(`${arg} needs a value`);
      flags.set(arg.slice(2), value);
      i += 1;
      continue;
    }
    positionals.push(arg);
  }
  return { positionals, flags };
}

/** Drain piped stdin. __readStdin is non-blocking, so: wait briefly for the
 *  first chunk, then call EOF after ~75ms of silence once data has arrived. */
function readStdinAll(): string {
  const [cols] = JSON.parse(__termSize()) as [number, number];
  if (cols > 0) return ''; // interactive tty, nothing piped
  let buffer = '';
  let quietRounds = 0;
  for (let round = 0; round < 200; round += 1) { // hard cap ~5s
    const chunk = __readStdin();
    if (chunk.length > 0) { buffer += chunk; quietRounds = 0; continue; }
    if (buffer.length > 0) {
      quietRounds += 1;
      if (quietRounds >= 3) break;
    }
    __sleepMs(25);
  }
  return buffer;
}

// ── printing ──────────────────────────────────────────────────────────────────

function oneLine(record: RequestRecord): string {
  const day = record.at.slice(0, 10);
  const preview = record.text.length > 80 ? `${record.text.slice(0, 80)}…` : record.text;
  return `${record.id}  ${record.status.toUpperCase().padEnd(6)}  ${day}  ${record.origin.padEnd(18)}  "${preview.replace(/\n/g, ' ')}"`;
}

function age(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!isFinite(ms) || ms < 0) return '?';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function boardRow(record: RequestRecord): string {
  const preview = record.text.length > 80 ? `${record.text.slice(0, 80)}…` : record.text;
  const tags = record.tags?.length ? `  ${record.tags.map((t) => `#${t}`).join(' ')}` : '';
  return `  ${record.id}  ${age(record.at).padStart(4)}  ${record.origin.padEnd(18)}  "${preview.replace(/\n/g, ' ')}"${tags}`;
}

function fullEntry(record: RequestRecord): string {
  const lines = [
    `${record.id} · ${record.status.toUpperCase()} · ${record.at} · origin: ${record.origin}`,
    `capture: ${record.captureMode ?? 'manual'}${record.sessionId ? ` · session: ${record.sessionId}` : ''}`,
    '',
    record.text,
  ];
  if (record.tags?.length) lines.push('', `tags: ${record.tags.map((t) => `#${t}`).join(' ')}`);
  if (record.resolution !== undefined) {
    lines.push('', `resolution (${record.resolvedAt}):`, record.resolution);
    lines.push('', `commits: ${record.shas && record.shas.length > 0 ? record.shas.join(' ') : '(none — no-code resolution)'}`);
  }
  const events = record.events ?? [];
  if (events.length > 0) {
    lines.push('', 'history:');
    for (const event of events) lines.push(`  ${eventLine(record.id, event, false)}`);
  }
  return lines.join('\n');
}

function eventLine(id: string, event: RequestEvent, withId: boolean): string {
  const head = withId ? `${id}  ` : '';
  const what = event.kind === 'state' ? `${event.from}→${event.to}` : 'note';
  const text = event.text ? `  "${event.text.replace(/\n/g, ' ').slice(0, 100)}"` : '';
  return `${head}${event.at}  ${what}  by ${event.actor}${text}`;
}

// ── commands ──────────────────────────────────────────────────────────────────

function cmdLog(positionals: string[], flags: Map<string, string>): void {
  if (positionals.length === 0) fail(`log needs the ask text.\n${USAGE}`, 2);
  if (positionals.length > 1) {
    fail('the ask arrived as multiple words — QUOTE it so it stays one verbatim string: request log "<ask>" --origin <origin>', 2);
  }
  const origin = flags.get('origin') ?? fail('--origin is required (which pane/lane, or supervisor-relay)', 2);
  const sessionId = flags.get('session');
  const record = logRequest(defaultRequestsDir(), positionals[0], origin, { sessionId, captureMode: 'manual' });
  console.log(`${record.id} logged (new) — claim with: tools/request move ${record.id} doing --by <you>`);
}

const DONE_ROWS_SHOWN = 8;

function cmdBoard(flags: Map<string, string>): void {
  const loaded = loadRequests();
  // --tag narrows the whole board to one secretary category (REQSEC-0607)
  const records = flags.has('tag') ? filterByTag(loaded, flags.get('tag')!) : loaded;
  if (flags.has('tag')) console.log(`(board filtered to #${flags.get('tag')})\n`);
  // dispatches + one-offs are records, not jobs — exempt from every column
  // unless --all (the columns must agree with the true open-asks set, like
  // list --open)
  const columns = boardColumns(records, flags.has('all'));
  const dispatches = records.filter((record) => record.origin === DISPATCH_ORIGIN).length;
  const oneOffs = records.filter(isOffBoard).length - dispatches;
  for (const status of ['new', 'doing', 'review', 'done'] as RequestStatus[]) {
    const inColumn = columns[status];
    console.log(`${status.toUpperCase()} (${inColumn.length})`);
    // done is the archive — full listing would drown the live columns
    const rows = status === 'done' ? inColumn.slice(-DONE_ROWS_SHOWN) : inColumn;
    if (status === 'done' && inColumn.length > rows.length) {
      console.log(`  (… ${inColumn.length - rows.length} earlier — \`request list\` for all)`);
    }
    for (const record of rows) console.log(boardRow(record));
    console.log('');
  }
  if (!flags.has('all') && dispatches + oneOffs > 0) {
    const parts = [
      ...(dispatches > 0 ? [`${dispatches} supervisor dispatches`] : []),
      ...(oneOffs > 0 ? [`${oneOffs} one-offs (unrelated to the editor/game)`] : []),
    ];
    console.log(`(${parts.join(' + ')} off-board — records, not jobs; \`board --all\` to include)`);
  }
  const since = flags.get('since');
  if (since !== undefined) {
    if (isNaN(new Date(since).getTime())) fail(`--since is not a timestamp: ${JSON.stringify(since)} (ISO, e.g. 2026-06-07T12:00:00Z)`, 2);
    const activity: { id: string; event: RequestEvent }[] = [];
    for (const record of records) {
      if (!flags.has('all') && isOffBoard(record)) continue;
      for (const event of record.events ?? []) {
        if (event.at > new Date(since).toISOString()) activity.push({ id: record.id, event });
      }
    }
    activity.sort((a, b) => (a.event.at < b.event.at ? -1 : a.event.at > b.event.at ? 1 : 0));
    console.log(`ACTIVITY since ${since} (${activity.length})`);
    for (const { id, event } of activity) console.log(`  ${eventLine(id, event, true)}`);
  }
}

function parseShas(raw: string): string[] {
  return raw.trim().toLowerCase() === 'none'
    ? []
    : raw.split(',').map((sha) => sha.trim()).filter((sha) => sha.length > 0);
}

function cmdMove(positionals: string[], flags: Map<string, string>): void {
  const id = positionals[0] ?? fail(`move needs an id.\n${USAGE}`, 2);
  const to = positionals[1] ?? fail('move needs a target state: new | doing | review | done', 2);
  const by = flags.get('by') ?? fail('--by is required: who is moving this (user, supervisor, or a worker label)', 2);
  const shasRaw = flags.get('shas');
  const record = moveRequest(defaultRequestsDir(), id, to as RequestStatus, {
    by,
    para: flags.get('para') ?? (flags.has('shas') ? readStdinAll() : undefined),
    shas: shasRaw !== undefined ? parseShas(shasRaw) : undefined,
    note: flags.get('note'),
  });
  console.log(`${record.id} → ${record.status}${record.status === 'review' ? ' (awaiting the user\'s word — only actor user flips review→done)' : ''}`);
}

function cmdNote(positionals: string[], flags: Map<string, string>): void {
  const id = positionals[0] ?? fail(`note needs an id.\n${USAGE}`, 2);
  const text = positionals[1] ?? fail('note needs the text: request note <id> --by <actor> "<text>"', 2);
  const by = flags.get('by') ?? fail('--by is required: who is noting this', 2);
  const record = noteRequest(defaultRequestsDir(), id, by, text);
  console.log(`${record.id} noted (${(record.events ?? []).length} history events)`);
}

/** The secretary's persistence door, also usable by hand. Bad tags are
 *  dropped silently; nothing valid = a no-op, never an error. */
function cmdTag(positionals: string[]): void {
  const id = positionals[0] ?? fail(`tag needs an id.\n${USAGE}`, 2);
  const raw = positionals[1] ?? fail('tag needs the tags: request tag <id> <tag,tag,...>', 2);
  const record = tagRequest(defaultRequestsDir(), id, raw.split(','));
  console.log(`${record.id} tags: ${record.tags?.length ? record.tags.map((t) => `#${t}`).join(' ') : '(none)'}`);
}

function cmdTags(): void {
  const records = loadRequests();
  const tags = allTags(records);
  if (tags.length === 0) {
    console.log('(no tags yet — the secretary has not run, or nothing was confident)');
    return;
  }
  for (const tag of tags) console.log(`#${tag.padEnd(16)} ${filterByTag(records, tag).length}`);
}

function cmdMigrateBoard(): void {
  const counts = migrateBoard(defaultRequestsDir());
  console.log(`migrate-board: ${counts.migrated} migrated (${counts.opens} open→new, ${counts.resolveds} resolved→done) · ${counts.untouched} already board-shaped`);
}

// ── hook mode: stdin carries the Claude Code hook payload JSON ────────────────

// Exit-code discipline: NEVER exit 2 from hook mode — in UserPromptSubmit,
// exit 2 BLOCKS and erases the user's prompt. A ledger bug must never eat an
// ask; exit 1 (non-blocking, stderr surfaced) is the loudest safe failure.
function hookPayload(): any {
  const raw = readStdinAll();
  if (raw.trim().length === 0) fail('hook mode expects the hook payload JSON on stdin', 1);
  try {
    return JSON.parse(raw);
  } catch {
    fail(`hook payload is not JSON: ${raw.slice(0, 120)}`, 1);
  }
}

/** UserPromptSubmit: marker-gated capture (REQBOARD-0607) — the req id lands
 *  in front of the worker as added context. Claude and Codex send the same
 *  payload shape ({session_id, prompt}); --cli codex only changes the origin
 *  label.
 *
 *  HOOKJSON-0606: the context line is emitted as the documented control JSON
 *  ({hookSpecificOutput: {hookEventName, additionalContext}}) — BOTH CLIs
 *  accept that shape. It must NEVER go out as plain text here: the line
 *  starts with '[' (a JSON array opener), and a strict host parser
 *  ("hook returned invalid user prompt submit JSON output") rejects
 *  JSON-looking stdout that doesn't parse instead of falling back to text. */
function cmdHookPrompt(flags: Map<string, string>): void {
  const payload = hookPayload();
  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : '';
  const prompt = typeof payload.prompt === 'string' ? payload.prompt : '';
  if (sessionId.length === 0) fail('hook payload has no session_id', 1);
  const originLabel = flags.get('cli') === 'codex' ? 'codex' : 'session';
  const result = hookCapturePrompt(defaultRequestsDir(), sessionId, prompt, undefined, originLabel);
  if (result.action === 'logged') {
    // REQSCOPE-0705: the hook can't judge scope — the SESSION can. The
    // context line carries the scope gate: editor/game-building work is
    // claimed into the pile as ever; an unrelated ask gets dropped off the
    // board as a one-off (the record stays, the board doesn't carry it).
    // V32 SURFACE-0705: game/editor asks are ALSO told to consult the oracle
    // first — enforced for BOTH CLIs here, the one line both of them read.
    const line = result.record.origin === DISPATCH_ORIGIN
      ? `[request-ledger] captured ${result.record.id} (supervisor dispatch — recorded for the durable record; its marker tracks resolution, no board flow required)`
      : `[request-ledger] captured ${result.record.id} on the board (new). SCOPE GATE first: is this ask about the editor/game building (this repo's game, editors, carts, framework)? IF YES — claim it (tools/request move ${result.record.id} doing --by <you>) and consult the oracle BEFORE deciding an approach: tools/request move first, then tools/oracle "<topic>" — RULINGS override code; heed the ACTIVE SURFACE banner (going-forward work is cart/editor/, hmsc-era pointers are reference only, V32). When done, move it to REVIEW: tools/request move ${result.record.id} review --by <you> --para "<what was done, why, what changed>" --shas <sha,...|none>. Only the user flips review→done. IF NO — it is a one-off/unrelated: drop it off the board (tools/request oneoff ${result.record.id} --by <you>) and just answer it; no board flow, no oracle.`;
    console.log(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: line },
    }));
  }
  // skipped → silent: unmarked prompts must cost the session nothing
}

/** Stop: nudge once per turn cycle about entries this session holds in
 *  'doing' (REQBOARD-0607 — claimed-but-not-reviewed is the only debt the
 *  worker owns; review→done belongs to the user).
 *  stop_hook_active means this nudge already fired — never loop.
 *  HOOKJSON-0606: every Stop emission is JSON on BOTH CLIs — Codex Stop is
 *  JSON-only by contract, and the plain-text reminder began with '[' (the
 *  strict-parser trap cmdHookPrompt documents); {"systemMessage"} is the
 *  documented context shape on both. The --cli flag no longer changes
 *  emission here (it still picks the origin label on capture). */
function cmdHookStop(): void {
  const payload = hookPayload();
  if (payload.stop_hook_active === true) return;
  const config = loadLedgerConfig();
  if (config.stopReminder === 'off') return;
  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : '';
  if (sessionId.length === 0) return;
  const doing = requestsForSession(defaultRequestsDir(), sessionId)
    .filter((record) => record.status === 'doing' && !isOffBoard(record));
  if (doing.length === 0) return;
  const listing = doing
    .map((record) => `${record.id} "${record.text.replace(/\n/g, ' ').slice(0, 100)}"`)
    .join('; ');
  const reason = `[request-ledger] ${doing.length} claimed job(s) still in doing for this session: ${listing}. Move each to review (tools/request move <id> review --by <you> --para "<paragraph>" --shas <sha,...|none>) or, if genuinely still in flight, say so and stop again — this reminder fires once per turn cycle.`;
  if (config.stopReminder === 'block-once') {
    console.log(JSON.stringify({ decision: 'block', reason }));
  } else {
    console.log(JSON.stringify({ systemMessage: reason })); // 'context': a JSON note, never bare text
  }
}

function cmdResolve(positionals: string[], flags: Map<string, string>): void {
  const id = positionals[0] ?? fail(`resolve needs an id.\n${USAGE}`, 2);
  const paragraph = flags.get('para') ?? readStdinAll();
  if (paragraph.trim().length === 0) fail('no paragraph — pass --para "<paragraph>" or pipe it on stdin', 2);
  const shasRaw = flags.get('shas') ?? fail('--shas is required — the commit SHAs implementing this (or "none" for a no-code resolution)', 2);
  const record = resolveRequest(defaultRequestsDir(), id, paragraph, parseShas(shasRaw), flags.get('by') ?? 'worker');
  console.log(`${record.id} → review (resolve is move-to-REVIEW now, NOT done — the user accepts review→done) — ${record.shas && record.shas.length > 0 ? `commits: ${record.shas.join(' ')}` : 'no-code resolution'}`);
}

function cmdList(flags: Map<string, string>): void {
  const all = loadRequests();
  const tagged = flags.has('tag') ? filterByTag(all, flags.get('tag')!) : all;
  const inSession = flags.has('session')
    ? tagged.filter((record) => record.sessionId === flags.get('session'))
    : tagged;
  // --open is the debt list (everything not yet done): supervisor dispatches
  // and one-offs are exempt from the board flow, so they hide there unless
  // --all asks.
  const records = flags.has('open')
    ? inSession.filter((record) => record.status !== 'done' && (flags.has('all') || !isOffBoard(record)))
    : inSession;
  if (records.length === 0) {
    console.log(flags.has('open') ? '(no open requests)' : '(empty ledger)');
    return;
  }
  for (const record of records) console.log(oneLine(record));
  const live = all.filter((record) => record.status !== 'done').length;
  console.log(`${records.length} shown · ${all.length} total · ${live} not done`);
}

function cmdMarkDispatch(positionals: string[]): void {
  const id = positionals[0] ?? fail(`mark-dispatch needs an id.\n${USAGE}`, 2);
  const record = markDispatch(defaultRequestsDir(), id);
  console.log(`${record.id} amended — origin: ${record.origin} (exempt from the open list and the stop nudge; the ask text is untouched)`);
}

/** REQSCOPE-0705: the session's drop-off door for asks unrelated to the
 *  editor/game building — off the board, record kept. */
function cmdOneOff(positionals: string[], flags: Map<string, string>): void {
  const id = positionals[0] ?? fail(`oneoff needs an id.\n${USAGE}`, 2);
  const by = flags.get('by') ?? fail('--by is required: who judged this a one-off (your worker label)', 2);
  const record = markOneOff(defaultRequestsDir(), id, by);
  console.log(`${record.id} dropped off the board — origin: ${record.origin} (one-off, unrelated to the editor/game; the record stays durable, the board/list --open/stop nudge stop carrying it)`);
}

function cmdShow(positionals: string[]): void {
  const id = positionals[0] ?? fail(`show needs an id.\n${USAGE}`, 2);
  const record = loadRequests().find((candidate) => candidate.id === id);
  if (!record) fail(`no such request: ${id}`);
  console.log(fullEntry(record));
}

// ── entry (argv = [script, command, ...rest]) ─────────────────────────────────

try {
  const [, command, ...rest] = process.argv;
  const { positionals, flags } = parseArgs(rest);
  if (command === 'board') cmdBoard(flags);
  else if (command === 'log') cmdLog(positionals, flags);
  else if (command === 'move') cmdMove(positionals, flags);
  else if (command === 'note') cmdNote(positionals, flags);
  else if (command === 'tag') cmdTag(positionals);
  else if (command === 'tags') cmdTags();
  else if (command === 'resolve') cmdResolve(positionals, flags);
  else if (command === 'list') cmdList(flags);
  else if (command === 'show') cmdShow(positionals);
  else if (command === 'migrate-board') cmdMigrateBoard();
  else if (command === 'mark-dispatch') cmdMarkDispatch(positionals);
  else if (command === 'oneoff') cmdOneOff(positionals, flags);
  else if (command === 'hook-prompt') cmdHookPrompt(flags);
  else if (command === 'hook-stop') cmdHookStop();
  else {
    console.error(USAGE);
    process.exit(2);
  }
} catch (error: any) {
  fail(error?.message ?? String(error));
}
