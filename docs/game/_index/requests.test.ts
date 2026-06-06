// requests.test.ts — P4 behavior suite for the REQUEST LEDGER (REQLEDGER-0606).
//
// Covers the dispatch's three demands: log/resolve round-trip, byte-verbatim
// preservation of the user's words, and the oracle matching entries by their
// verbatim text + resolutions. Runs against a temp dir under /tmp — the real
// ledger (docs/game/_requests/) is never touched.
//
//   tools/esbuild docs/game/_index/requests.test.ts --bundle \
//     --outfile=zig-out/game/tests/requests.test.js --format=iife \
//     --platform=neutral --target=es2022
//   tools/v8cli zig-out/game/tests/requests.test.js
//
// (`rjit game verify` does this for every suite under its roots.)

import { test, assert, assertEqual, assertThrows, finish } from '../../../cart/hmsc-int/game/_testkit';
import {
  loadRequests, logRequest, resolveRequest, MIN_RESOLUTION_CHARS,
  hookCapturePrompt, requestsForSession, loadLedgerConfig, DEFAULT_LEDGER_CONFIG,
  type RequestRecord,
} from './requests';
import { searchRequests, tokenize } from './oracle';

declare const __fs_mkdir: (path: string) => boolean;
declare const __fs_remove: (path: string) => boolean;
declare const __fs_read: (path: string) => string | null;
declare const __fs_write: (path: string, content: string) => boolean;

const TMP = `/tmp/reactjit-requests-test-${Date.now()}`;

function freshDir(name: string): string {
  const dir = `${TMP}/${name}`;
  __fs_mkdir(dir);
  return dir;
}

const PARAGRAPH = 'Implemented the request ledger end to end: storage module, CLI, oracle tier, conduct rule, and this very test suite, so that every user ask becomes a durable record with an accountable resolution.';

// ── log/resolve round-trip ────────────────────────────────────────────────────

test('log opens an entry; resolve flips it with paragraph + shas', () => {
  const dir = freshDir('roundtrip');
  const logged = logRequest(dir, 'make the thing do the thing', 'pane-3');
  assertEqual(logged.id, 'req_0001', 'first entry gets seq 1');
  assertEqual(logged.status, 'open', 'fresh entry is open');

  const open = loadRequests(dir).filter((r) => r.status === 'open');
  assertEqual(open.length, 1, 'one open entry after log');

  const resolved = resolveRequest(dir, 'req_0001', PARAGRAPH, ['b6fd34eb9', '659e6e52c']);
  assertEqual(resolved.status, 'resolved', 'resolve flips status');
  assertEqual(resolved.resolution, PARAGRAPH, 'paragraph stored');
  assertEqual(resolved.shas!.join(','), 'b6fd34eb9,659e6e52c', 'shas stored');
  assert(typeof resolved.resolvedAt === 'string' && resolved.resolvedAt!.length > 0, 'resolvedAt stamped');

  const after = loadRequests(dir);
  assertEqual(after.filter((r) => r.status === 'open').length, 0, 'list --open empty after resolve');
  assertEqual(after.length, 1, 'resolution is a field-fill, not a new entry');
});

test('ids are sequential and load order is ascending', () => {
  const dir = freshDir('seq');
  logRequest(dir, 'first ask', 'lane-a');
  logRequest(dir, 'second ask', 'lane-b');
  logRequest(dir, 'third ask', 'lane-c');
  const ids = loadRequests(dir).map((r) => r.id);
  assertEqual(ids.join(','), 'req_0001,req_0002,req_0003', 'sequential ascending ids');
});

// ── verbatim preservation ─────────────────────────────────────────────────────

test('the ask survives byte-verbatim through log → disk → load → resolve', () => {
  const dir = freshDir('verbatim');
  const gnarly = `  maybe there is a way... "quotes", 'single', back\\slash,
two
newlines, emoji 🎯, trailing spaces  `;
  const logged = logRequest(dir, gnarly, 'supervisor-relay');
  assertEqual(loadRequests(dir)[0].text, gnarly, 'verbatim after log');

  resolveRequest(dir, logged.id, PARAGRAPH, []);
  assertEqual(loadRequests(dir)[0].text, gnarly, 'verbatim untouched by resolve');

  // belt-and-braces: the raw file's parsed text, not just the loader's view
  const raw = JSON.parse(__fs_read(`${dir}/${logged.id}.json`)!) as RequestRecord;
  assertEqual(raw.text, gnarly, 'verbatim on disk');
});

// ── boundary validation (by-addition law) ─────────────────────────────────────

test('the boundary rejects bad input loudly', () => {
  const dir = freshDir('guards');
  assertThrows(() => logRequest(dir, '   ', 'pane-1'), 'empty ask rejected');
  assertThrows(() => logRequest(dir, 'an ask', ''), 'missing origin rejected');

  const logged = logRequest(dir, 'an ask', 'pane-1');
  assertThrows(() => resolveRequest(dir, 'req_9999', PARAGRAPH, []), 'unknown id rejected');
  assertThrows(() => resolveRequest(dir, logged.id, 'too short', []), 'one-liner resolution rejected');
  assert(PARAGRAPH.length >= MIN_RESOLUTION_CHARS, 'test paragraph clears the bar');
  assertThrows(() => resolveRequest(dir, logged.id, PARAGRAPH, ['not-a-sha!']), 'non-hex sha rejected');

  resolveRequest(dir, logged.id, PARAGRAPH, ['abcdef1']);
  assertThrows(() => resolveRequest(dir, logged.id, PARAGRAPH, ['abcdef1']), 'double resolution rejected — entries are never rewritten');
});

// ── oracle match ──────────────────────────────────────────────────────────────

test('oracle ranks entries by verbatim ask text and by resolution words', () => {
  const dir = freshDir('oracle');
  logRequest(dir, 'the cursor ring should be the dab footprint at any zoom', 'pane-paint');
  const other = logRequest(dir, 'tabs should reopen in their last order', 'pane-shell');
  resolveRequest(dir, other.id, `Reordered workspace persistence so reopened tabs restore their previous arrangement; the session file now records tab order and the shell replays it on boot. ${PARAGRAPH}`, ['1234abcd']);

  const requests = loadRequests(dir);

  const byAsk = searchRequests(tokenize('cursor ring dab footprint'), requests);
  assert(byAsk.length > 0, 'verbatim ask text matches');
  assertEqual(byAsk[0].item.id, 'req_0001', 'ask-text match ranks the right entry first');

  const byResolution = searchRequests(tokenize('workspace persistence arrangement'), requests);
  assert(byResolution.length > 0, 'resolution paragraph matches');
  assertEqual(byResolution[0].item.id, other.id, 'resolution match ranks the resolved entry first');
  assertEqual(byResolution[0].item.status, 'resolved', 'match carries status');
  assertEqual((byResolution[0].item.shas ?? []).join(','), '1234abcd', 'match carries shas');

  assertEqual(searchRequests(tokenize('quaternion skybox raytracer'), requests).length, 0, 'unrelated query matches nothing');
});

// ── hook auto-capture (REQLEDGER-0606 addendum) ──────────────────────────────

const SESSION = 'abc12345-6789-dead-beef-000000000001';

test('hook capture logs the literal prompt with sessionId + captureMode', () => {
  const dir = freshDir('hook');
  const literal = 'please make the voxel editor respect the same camera convention as the test route';
  const result = hookCapturePrompt(dir, SESSION, literal, DEFAULT_LEDGER_CONFIG);
  assertEqual(result.action, 'logged', 'substantive prompt is captured');
  const record = loadRequests(dir)[0];
  assertEqual(record.text, literal, 'prompt stored verbatim');
  assertEqual(record.sessionId, SESSION, 'sessionId stored (the report key)');
  assertEqual(record.captureMode, 'hook', 'captureMode marks the auto path');
  assertEqual(record.origin, `session:${SESSION.slice(0, 8)}`, 'origin derives from session');
});

test('codex captures share the write path, diverging only in the origin label', () => {
  const dir = freshDir('codex');
  const literal = 'please wire the painter so the texture lands on the selected face of the piece';
  const result = hookCapturePrompt(dir, 'c0dex123-4567-89ab-cdef-000000000042', literal, DEFAULT_LEDGER_CONFIG, 'codex');
  assertEqual(result.action, 'logged', 'codex prompt captured');
  const record = loadRequests(dir)[0];
  assertEqual(record.text, literal, 'verbatim through the shared path');
  assertEqual(record.origin, 'codex:c0dex123', 'origin names the capturing CLI');
  assertEqual(record.captureMode, 'hook', 'same captureMode vocabulary');
});

test('the noise rule skips acks, commands, and short prompts — never logs them', () => {
  const dir = freshDir('noise');
  const skipped = [
    'ok do it',                       // ack
    'yes',                            // ack
    '/clear',                         // slash command
    '! git status',                   // shell passthrough
    'fix it',                         // under minPromptChars
    '   ',                            // empty
  ];
  for (const prompt of skipped) {
    assertEqual(hookCapturePrompt(dir, SESSION, prompt, DEFAULT_LEDGER_CONFIG).action, 'skipped', `skipped: ${JSON.stringify(prompt)}`);
  }
  assertEqual(loadRequests(dir).length, 0, 'noise leaves the ledger untouched');
});

test('the noise rule is a tunable knob: _config.json overrides key-by-key', () => {
  const dir = freshDir('config');
  assertEqual(loadLedgerConfig(dir).minPromptChars, DEFAULT_LEDGER_CONFIG.minPromptChars, 'defaults without a file');
  __fs_write(`${dir}/_config.json`, '{ "minPromptChars": 5 }\n');
  const tuned = loadLedgerConfig(dir);
  assertEqual(tuned.minPromptChars, 5, 'override applies');
  assertEqual(tuned.stopReminder, DEFAULT_LEDGER_CONFIG.stopReminder, 'unset keys keep defaults');
  assertEqual(hookCapturePrompt(dir, SESSION, 'fix the door', tuned).action, 'logged', 'tuned threshold changes capture behavior');
  assertEqual(loadRequests(dir).length, 1, '_config.json is not a ledger entry');
});

test('requestsForSession groups a session\'s asks — the report key', () => {
  const dir = freshDir('session');
  hookCapturePrompt(dir, SESSION, 'first substantive ask, long enough to clear the bar', DEFAULT_LEDGER_CONFIG);
  hookCapturePrompt(dir, 'ffff0000-0000-0000-0000-000000000099', 'other session ask, also long enough to clear the bar', DEFAULT_LEDGER_CONFIG);
  logRequest(dir, 'manually relayed ask for the same session', 'supervisor-relay', { sessionId: SESSION });
  const mine = requestsForSession(dir, SESSION);
  assertEqual(mine.length, 2, 'hook + manual entries group by sessionId');
  assert(mine.every((record) => record.sessionId === SESSION), 'only this session\'s entries');
  resolveRequest(dir, mine[0].id, PARAGRAPH, []);
  const open = requestsForSession(dir, SESSION).filter((record) => record.status === 'open');
  assertEqual(open.length, 1, 'the stop-hook scan sees only unresolved entries');
});

// cases run inside finish(), so cleanup must be the last CASE — a plain
// __fs_remove here would run before any test created its dir.
test('cleanup: temp ledger dirs removed', () => {
  assert(__fs_remove(TMP), 'temp dir removed');
});

finish('requests');
