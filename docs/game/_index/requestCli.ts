// requestCli.ts — `tools/request`: the REQUEST LEDGER CLI (REQLEDGER-0606).
//
//   tools/request log "<the user's words, VERBATIM>" --origin <pane|lane|supervisor-relay>
//   tools/request resolve <id> --para "<paragraph>" --shas <sha,sha|none>
//   echo "<paragraph>" | tools/request resolve <id> --shas <sha,...>
//   tools/request list [--open]
//   tools/request show <id>
//
// Storage + validation live in requests.ts (the deep module); this file is
// argv parsing and printing only. Runs under tools/v8cli via the tools/request
// wrapper, which exports RJIT_ROOT so the ledger dir resolves from anywhere.

import {
  defaultRequestsDir, loadRequests, logRequest, resolveRequest,
  hookCapturePrompt, requestsForSession, loadLedgerConfig,
  markDispatch, DISPATCH_ORIGIN,
  type RequestRecord,
} from './requests';

declare const __readStdin: () => string;
declare const __sleepMs: (ms: number) => void;
declare const __termSize: () => string; // JSON [cols, rows]; [0,0] when stdin isn't a tty
declare const process: { argv: string[]; exit(code: number): void };

const USAGE = `request — the REQUEST LEDGER (user asks → resolutions; docs/game/REQUESTS.md)

  request log "<verbatim ask>" --origin <pane|lane|supervisor-relay> [--session <id>]
  request resolve <id> --para "<paragraph>" --shas <sha,sha|none>
      (or pipe the paragraph on stdin instead of --para)
  request list [--open] [--all] [--session <id>]
      (--open hides supervisor dispatches; add --all to show everything)
  request show <id>
  request mark-dispatch <id>   amend a mis-captured entry to supervisor-dispatch

hook mode (wired by .claude/settings.json + .codex/hooks.json; payload JSON on stdin):
  request hook-prompt [--cli codex]   UserPromptSubmit → auto-capture the literal prompt
  request hook-stop   [--cli codex]   Stop → remind the session of its unresolved asks`;

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
  return `${record.id}  ${record.status.toUpperCase().padEnd(8)}  ${day}  ${record.origin.padEnd(18)}  "${preview.replace(/\n/g, ' ')}"`;
}

function fullEntry(record: RequestRecord): string {
  const lines = [
    `${record.id} · ${record.status.toUpperCase()} · ${record.at} · origin: ${record.origin}`,
    `capture: ${record.captureMode ?? 'manual'}${record.sessionId ? ` · session: ${record.sessionId}` : ''}`,
    '',
    record.text,
  ];
  if (record.status === 'resolved') {
    lines.push('', `resolved ${record.resolvedAt}:`, record.resolution ?? '');
    lines.push('', `commits: ${record.shas && record.shas.length > 0 ? record.shas.join(' ') : '(none — no-code resolution)'}`);
  }
  return lines.join('\n');
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
  console.log(`${record.id} logged (open) — resolve with: tools/request resolve ${record.id} --para "<paragraph>" --shas <sha,...>`);
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

/** UserPromptSubmit: capture the LITERAL prompt — the req id lands in front
 *  of the worker as added context. Claude and Codex send the same payload
 *  shape ({session_id, prompt}); --cli codex only changes the origin label.
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
    const line = result.record.origin === DISPATCH_ORIGIN
      ? `[request-ledger] captured ${result.record.id} (supervisor dispatch — recorded for the durable record; its marker tracks resolution, no ledger resolve required)`
      : `[request-ledger] captured ${result.record.id} (this prompt, verbatim). Your work is not done until: tools/request resolve ${result.record.id} --para "<what was done, why, what changed>" --shas <sha,...|none>`;
    console.log(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: line },
    }));
  }
  // skipped → silent: noise must cost the session nothing
}

/** Stop: nudge once per turn cycle about this session's unresolved captures.
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
  const open = requestsForSession(defaultRequestsDir(), sessionId)
    .filter((record) => record.status === 'open' && record.origin !== DISPATCH_ORIGIN);
  if (open.length === 0) return;
  const listing = open
    .map((record) => `${record.id} "${record.text.replace(/\n/g, ' ').slice(0, 100)}"`)
    .join('; ');
  const reason = `[request-ledger] ${open.length} unresolved ask(s) captured for this session: ${listing}. Resolve each (tools/request resolve <id> --para "<paragraph>" --shas <sha,...|none>) or, if genuinely still in flight, say so and stop again — this reminder fires once per turn cycle.`;
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
  const shas = shasRaw.trim().toLowerCase() === 'none'
    ? []
    : shasRaw.split(',').map((sha) => sha.trim()).filter((sha) => sha.length > 0);
  const record = resolveRequest(defaultRequestsDir(), id, paragraph, shas);
  console.log(`${record.id} resolved — ${record.shas && record.shas.length > 0 ? `commits: ${record.shas.join(' ')}` : 'no-code resolution'}`);
}

function cmdList(flags: Map<string, string>): void {
  const all = loadRequests();
  const inSession = flags.has('session')
    ? all.filter((record) => record.sessionId === flags.get('session'))
    : all;
  // --open is the debt list: supervisor dispatches are exempt from the
  // resolution requirement, so they hide there unless --all asks for them.
  const records = flags.has('open')
    ? inSession.filter((record) => record.status === 'open' && (flags.has('all') || record.origin !== DISPATCH_ORIGIN))
    : inSession;
  if (records.length === 0) {
    console.log(flags.has('open') ? '(no open requests)' : '(empty ledger)');
    return;
  }
  for (const record of records) console.log(oneLine(record));
  const open = all.filter((record) => record.status === 'open').length;
  console.log(`${records.length} shown · ${all.length} total · ${open} open`);
}

function cmdMarkDispatch(positionals: string[]): void {
  const id = positionals[0] ?? fail(`mark-dispatch needs an id.\n${USAGE}`, 2);
  const record = markDispatch(defaultRequestsDir(), id);
  console.log(`${record.id} amended — origin: ${record.origin} (exempt from the open list and the stop nudge; the ask text is untouched)`);
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
  if (command === 'log') cmdLog(positionals, flags);
  else if (command === 'resolve') cmdResolve(positionals, flags);
  else if (command === 'list') cmdList(flags);
  else if (command === 'show') cmdShow(positionals);
  else if (command === 'mark-dispatch') cmdMarkDispatch(positionals);
  else if (command === 'hook-prompt') cmdHookPrompt(flags);
  else if (command === 'hook-stop') cmdHookStop();
  else {
    console.error(USAGE);
    process.exit(2);
  }
} catch (error: any) {
  fail(error?.message ?? String(error));
}
