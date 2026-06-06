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
  type RequestRecord,
} from './requests';

declare const __readStdin: () => string;
declare const __sleepMs: (ms: number) => void;
declare const __termSize: () => string; // JSON [cols, rows]; [0,0] when stdin isn't a tty
declare const process: { argv: string[]; exit(code: number): void };

const USAGE = `request — the REQUEST LEDGER (user asks → resolutions; docs/game/REQUESTS.md)

  request log "<verbatim ask>" --origin <pane|lane|supervisor-relay>
  request resolve <id> --para "<paragraph>" --shas <sha,sha|none>
      (or pipe the paragraph on stdin instead of --para)
  request list [--open]
  request show <id>`;

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
  const record = logRequest(defaultRequestsDir(), positionals[0], origin);
  console.log(`${record.id} logged (open) — resolve with: tools/request resolve ${record.id} --para "<paragraph>" --shas <sha,...>`);
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
  const records = flags.has('open') ? all.filter((record) => record.status === 'open') : all;
  if (records.length === 0) {
    console.log(flags.has('open') ? '(no open requests)' : '(empty ledger)');
    return;
  }
  for (const record of records) console.log(oneLine(record));
  const open = all.filter((record) => record.status === 'open').length;
  console.log(`${records.length} shown · ${all.length} total · ${open} open`);
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
  else {
    console.error(USAGE);
    process.exit(2);
  }
} catch (error: any) {
  fail(error?.message ?? String(error));
}
