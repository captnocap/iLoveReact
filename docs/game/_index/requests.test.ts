// requests.test.ts — P4 behavior suite for the REQUEST LEDGER job board
// (REQLEDGER-0606 → four-state board REQBOARD-0607).
//
// Covers: legacy two-state normalization on read; every legal transition;
// every illegal transition rejected (especially a worker attempting
// review→done, and any move out of done); para+shas demanded at doing→review;
// marker-only hook capture (marker hit, marker miss, dispatch prefix);
// migrate-board idempotence; events append-only ordering; byte-verbatim
// preservation; the oracle matching entries by verbatim text + resolutions.
// Runs against a temp dir under /tmp — the real ledger (docs/game/_requests/)
// is never touched.
//
//   tools/esbuild docs/game/_index/requests.test.ts --bundle \
//     --outfile=zig-out/game/tests/requests.test.js --format=iife \
//     --platform=neutral --target=es2022
//   tools/v8cli zig-out/game/tests/requests.test.js
//
// (`rjit game verify` does this for every suite under its roots.)

import { test, assert, assertEqual, assertThrows, finish } from '../../../cart/hmsc-int/game/_testkit';
import {
  loadRequests, logRequest, resolveRequest, moveRequest, noteRequest,
  migrateBoard, boardColumns, MIN_RESOLUTION_CHARS,
  tagRequest, filterByTag, allTags, SEED_TAGS, SECRETARY_PROMPT_PREFIX,
  hookCapturePrompt, requestsForSession, loadLedgerConfig, DEFAULT_LEDGER_CONFIG,
  markDispatch, DISPATCH_ORIGIN, markOneOff, ONEOFF_ORIGIN, isOffBoard,
  type RequestRecord, type RequestStatus,
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

const PARAGRAPH = 'Implemented the request board end to end: four states, the transition function, CLI verbs, marker-gated capture, and this very test suite, so that every job becomes a durable record with an accountable, user-accepted resolution.';

/** Write a raw entry file directly — the legacy-file and corrupt-file rig. */
function writeRaw(dir: string, id: string, record: Record<string, unknown>): void {
  __fs_write(`${dir}/${id}.json`, JSON.stringify(record, null, 2) + '\n');
}

const LEGACY_OPEN = {
  id: 'req_0001', at: '2026-06-06T04:00:00.000Z', origin: 'pane-3',
  text: 'a legacy ask from the two-state era', status: 'open',
};
const LEGACY_RESOLVED = {
  id: 'req_0002', at: '2026-06-06T05:00:00.000Z', origin: 'pane-4',
  text: 'a legacy ask already closed in the two-state era', status: 'resolved',
  resolvedAt: '2026-06-06T06:00:00.000Z', resolution: PARAGRAPH, shas: ['abcdef1'],
};

// ── legacy normalization on read ──────────────────────────────────────────────

test('legacy statuses normalize on read: open→new, resolved→done', () => {
  const dir = freshDir('legacy');
  writeRaw(dir, 'req_0001', LEGACY_OPEN);
  writeRaw(dir, 'req_0002', LEGACY_RESOLVED);
  const [open, resolved] = loadRequests(dir);
  assertEqual(open.status, 'new', 'open reads as new');
  assertEqual(resolved.status, 'done', 'resolved reads as done');
  assertEqual(resolved.resolution, PARAGRAPH, 'legacy resolution fields survive');
  // the files themselves are untouched by reading
  assert(__fs_read(`${dir}/req_0001.json`)!.includes('"open"'), 'read does not rewrite the file');
});

// ── the board: legal transitions ──────────────────────────────────────────────

test('the full happy path: new → doing → review → done (user accepts)', () => {
  const dir = freshDir('happy');
  const job = logRequest(dir, 'JOB: make the thing do the thing', 'pane-3');
  assertEqual(job.status, 'new', 'fresh entry lands in new');

  const claimed = moveRequest(dir, job.id, 'doing', { by: 'worker-7' });
  assertEqual(claimed.status, 'doing', 'worker claims new→doing');

  const reviewed = moveRequest(dir, job.id, 'review', { by: 'worker-7', para: PARAGRAPH, shas: ['b6fd34eb9', '659e6e52c'] });
  assertEqual(reviewed.status, 'review', 'doing→review with paragraph + shas');
  assertEqual(reviewed.resolution, PARAGRAPH, 'paragraph fills at doing→review');
  assertEqual(reviewed.shas!.join(','), 'b6fd34eb9,659e6e52c', 'shas fill at doing→review');
  assert(typeof reviewed.resolvedAt === 'string' && reviewed.resolvedAt!.length > 0, 'resolvedAt stamped at doing→review');

  const done = moveRequest(dir, job.id, 'done', { by: 'user' });
  assertEqual(done.status, 'done', 'user accepts review→done');
  assertEqual(done.resolution, PARAGRAPH, 'done is acceptance only — resolution untouched');
  assertEqual(loadRequests(dir).length, 1, 'transitions are field-changes, not new entries');
});

test('review→new bounce (note required) and the rework loop keeps the original resolution', () => {
  const dir = freshDir('bounce');
  const job = logRequest(dir, 'JOB: fix the door', 'pane-1');
  moveRequest(dir, job.id, 'doing', { by: 'worker-1' });
  moveRequest(dir, job.id, 'review', { by: 'worker-1', para: PARAGRAPH, shas: [] });

  assertThrows(() => moveRequest(dir, job.id, 'new', { by: 'supervisor' }), 'bounce without a note rejected');
  const bounced = moveRequest(dir, job.id, 'new', { by: 'supervisor', note: 'door still sticks on the second click' });
  assertEqual(bounced.status, 'new', 'bounce lands back in new');
  assertEqual(bounced.resolution, PARAGRAPH, 'bounce never erases the filled resolution');

  // rework: the second doing→review still demands the discipline, but the
  // once-filled fields stand — the fresh paragraph rides the event
  moveRequest(dir, job.id, 'doing', { by: 'worker-2' });
  assertThrows(() => moveRequest(dir, job.id, 'review', { by: 'worker-2', shas: [] }), 're-review still demands the paragraph');
  const second = moveRequest(dir, job.id, 'review', { by: 'worker-2', para: `Second pass: ${PARAGRAPH}`, shas: ['1234abcd'] });
  assertEqual(second.resolution, PARAGRAPH, 'resolution fields fill exactly once, never rewritten');
  assertEqual(second.shas!.join(','), '', 'original shas stand too');
  const lastEvent = second.events![second.events!.length - 1];
  assert((lastEvent.text ?? '').startsWith('Second pass:'), 'the rework paragraph rides the transition event');
});

test('new→done is the supervisor-only noise-close, note required', () => {
  const dir = freshDir('noiseclose');
  const job = logRequest(dir, 'JOB: actually just a perf log, mis-marked', 'pane-2');
  assertThrows(() => moveRequest(dir, job.id, 'done', { by: 'worker-3', note: 'noise' }), 'worker cannot noise-close');
  assertThrows(() => moveRequest(dir, job.id, 'done', { by: 'user', note: 'noise' }), 'noise-close is the supervisor verb, not even user');
  assertThrows(() => moveRequest(dir, job.id, 'done', { by: 'supervisor' }), 'noise-close without a note rejected');
  const closed = moveRequest(dir, job.id, 'done', { by: 'supervisor', note: 'perf log, not a job' });
  assertEqual(closed.status, 'done', 'supervisor noise-closes new→done with a note');
});

// ── the board: illegal transitions ────────────────────────────────────────────

test('a worker may NEVER flip review→done — only actor user', () => {
  const dir = freshDir('gate');
  const job = logRequest(dir, 'JOB: gated work', 'pane-5');
  moveRequest(dir, job.id, 'doing', { by: 'worker-9' });
  moveRequest(dir, job.id, 'review', { by: 'worker-9', para: PARAGRAPH, shas: [] });
  assertThrows(() => moveRequest(dir, job.id, 'done', { by: 'worker-9' }), 'worker review→done rejected');
  assertThrows(() => moveRequest(dir, job.id, 'done', { by: 'supervisor' }), 'even supervisor cannot accept without the user\'s word as actor user');
  assertEqual(loadRequests(dir)[0].status, 'review', 'rejected moves change nothing');
  moveRequest(dir, job.id, 'done', { by: 'user' });
});

test('done is terminal: no move out, ever', () => {
  const dir = freshDir('terminal');
  const job = logRequest(dir, 'JOB: short-lived', 'pane-6');
  moveRequest(dir, job.id, 'done', { by: 'supervisor', note: 'triage close for the terminality test' });
  for (const target of ['new', 'doing', 'review'] as RequestStatus[]) {
    assertThrows(() => moveRequest(dir, job.id, target, { by: 'supervisor', note: 'n', para: PARAGRAPH, shas: [] }), `done→${target} rejected`);
  }
  assertThrows(() => moveRequest(dir, job.id, 'done', { by: 'user' }), 'done→done rejected too');
});

test('every other off-graph move is rejected with the legal moves named', () => {
  const dir = freshDir('offgraph');
  const job = logRequest(dir, 'JOB: graph walker', 'pane-7');
  // from new
  assertThrows(() => moveRequest(dir, job.id, 'review', { by: 'w', para: PARAGRAPH, shas: [] }), 'new→review rejected (claim first)');
  assertThrows(() => moveRequest(dir, job.id, 'new', { by: 'w' }), 'new→new rejected');
  // from doing — doing may ONLY go to review (no unclaim, no done, no noise-close)
  moveRequest(dir, job.id, 'doing', { by: 'w' });
  assertThrows(() => moveRequest(dir, job.id, 'done', { by: 'supervisor', note: 'n' }), 'doing→done rejected — noise-close is NEVER available from doing');
  assertThrows(() => moveRequest(dir, job.id, 'done', { by: 'user' }), 'doing→done rejected even for user');
  assertThrows(() => moveRequest(dir, job.id, 'new', { by: 'w', note: 'n' }), 'doing→new rejected');
  assertThrows(() => moveRequest(dir, job.id, 'doing', { by: 'w' }), 'doing→doing rejected');
  // from review
  moveRequest(dir, job.id, 'review', { by: 'w', para: PARAGRAPH, shas: [] });
  assertThrows(() => moveRequest(dir, job.id, 'review', { by: 'w', para: PARAGRAPH, shas: [] }), 'review→review rejected');
  assertThrows(() => moveRequest(dir, job.id, 'doing', { by: 'w' }), 'review→doing rejected (bounce goes review→new)');
  // the rejection message teaches the graph
  try {
    moveRequest(dir, job.id, 'doing', { by: 'w' });
    assert(false, 'unreachable');
  } catch (error: any) {
    assert(String(error.message).includes('review→done') && String(error.message).includes('review→new'), 'error names the legal moves');
  }
});

// ── doing→review demands the resolve discipline ───────────────────────────────

test('doing→review demands paragraph ≥ bar and well-formed shas', () => {
  const dir = freshDir('discipline');
  const job = logRequest(dir, 'JOB: disciplined work', 'pane-8');
  moveRequest(dir, job.id, 'doing', { by: 'w' });
  assert(PARAGRAPH.length >= MIN_RESOLUTION_CHARS, 'test paragraph clears the bar');
  assertThrows(() => moveRequest(dir, job.id, 'review', { by: 'w', shas: [] }), 'missing paragraph rejected');
  assertThrows(() => moveRequest(dir, job.id, 'review', { by: 'w', para: 'too short', shas: [] }), 'one-liner paragraph rejected');
  assertThrows(() => moveRequest(dir, job.id, 'review', { by: 'w', para: PARAGRAPH }), 'missing shas rejected');
  assertThrows(() => moveRequest(dir, job.id, 'review', { by: 'w', para: PARAGRAPH, shas: ['not-a-sha!'] }), 'non-hex sha rejected');
  assertEqual(loadRequests(dir)[0].status, 'doing', 'rejected review attempts change nothing');
});

test('resolveRequest is the doing→review alias — work lands in review, not done', () => {
  const dir = freshDir('alias');
  const job = logRequest(dir, 'JOB: old habits', 'pane-9');
  assertThrows(() => resolveRequest(dir, job.id, PARAGRAPH, []), 'resolve from new rejected — claim first (new→doing)');
  moveRequest(dir, job.id, 'doing', { by: 'worker-old' });
  const reviewed = resolveRequest(dir, job.id, PARAGRAPH, ['abcdef1']);
  assertEqual(reviewed.status, 'review', 'resolve = move review, NOT done');
  assertThrows(() => resolveRequest(dir, job.id, PARAGRAPH, ['abcdef1']), 'double resolve rejected (review→review is off-graph)');
});

// ── events: append-only history ───────────────────────────────────────────────

test('events append in order and are never rewritten', () => {
  const dir = freshDir('events');
  const job = logRequest(dir, 'JOB: historied work', 'pane-10');
  assertEqual((loadRequests(dir)[0].events ?? []).length, 0, 'fresh entry has an empty history');

  noteRequest(dir, job.id, 'supervisor', 'queued behind the perf hunt');
  moveRequest(dir, job.id, 'doing', { by: 'worker-2' });
  noteRequest(dir, job.id, 'worker-2', 'halfway, the collider was the culprit');
  moveRequest(dir, job.id, 'review', { by: 'worker-2', para: PARAGRAPH, shas: [] });
  moveRequest(dir, job.id, 'done', { by: 'user' });
  noteRequest(dir, job.id, 'supervisor', 'post-acceptance annotation still appends');

  const events = loadRequests(dir)[0].events!;
  assertEqual(events.map((e) => e.kind).join(','), 'note,state,note,state,state,note', 'every action appended one event, in order');
  assertEqual(events.filter((e) => e.kind === 'state').map((e) => `${e.from}>${e.to}`).join(','), 'new>doing,doing>review,review>done', 'transition trail intact');
  assertEqual(events[0].text, 'queued behind the perf hunt', 'earliest event untouched by later appends');
  assert(events.every((e) => typeof e.at === 'string' && e.actor.length > 0), 'every event carries at + actor');
});

// ── verbatim preservation ─────────────────────────────────────────────────────

test('the ask survives byte-verbatim through log → disk → load → the whole board', () => {
  const dir = freshDir('verbatim');
  const gnarly = `JOB:   maybe there is a way... "quotes", 'single', back\\slash,
two
newlines, emoji 🎯, trailing spaces  `;
  const logged = logRequest(dir, gnarly, 'supervisor-relay');
  assertEqual(loadRequests(dir)[0].text, gnarly, 'verbatim after log (marker included)');

  moveRequest(dir, logged.id, 'doing', { by: 'w' });
  moveRequest(dir, logged.id, 'review', { by: 'w', para: PARAGRAPH, shas: [] });
  moveRequest(dir, logged.id, 'done', { by: 'user' });
  assertEqual(loadRequests(dir)[0].text, gnarly, 'verbatim untouched by every transition');

  // belt-and-braces: the raw file's parsed text, not just the loader's view
  const raw = JSON.parse(__fs_read(`${dir}/${logged.id}.json`)!) as RequestRecord;
  assertEqual(raw.text, gnarly, 'verbatim on disk');
});

// ── boundary validation ───────────────────────────────────────────────────────

test('the boundary rejects bad input loudly', () => {
  const dir = freshDir('guards');
  assertThrows(() => logRequest(dir, '   ', 'pane-1'), 'empty ask rejected');
  assertThrows(() => logRequest(dir, 'an ask', ''), 'missing origin rejected');
  const job = logRequest(dir, 'an ask', 'pane-1');
  assertThrows(() => moveRequest(dir, 'req_9999', 'doing', { by: 'w' }), 'unknown id rejected');
  assertThrows(() => moveRequest(dir, job.id, 'shipped' as RequestStatus, { by: 'w' }), 'not-a-state rejected');
  assertThrows(() => moveRequest(dir, job.id, 'doing', { by: '  ' }), 'missing actor rejected');
  assertThrows(() => noteRequest(dir, job.id, 'w', '   '), 'empty note rejected');
});

// ── migrate-board ─────────────────────────────────────────────────────────────

test('migrate-board rewrites legacy statuses once, idempotently, touching nothing else', () => {
  const dir = freshDir('migrate');
  writeRaw(dir, 'req_0001', LEGACY_OPEN);
  writeRaw(dir, 'req_0002', LEGACY_RESOLVED);
  logRequest(dir, 'JOB: already board-shaped', 'pane-1');

  const first = migrateBoard(dir);
  assertEqual(first.migrated, 2, 'both legacy entries migrated');
  assertEqual(first.opens, 1, 'one open→new');
  assertEqual(first.resolveds, 1, 'one resolved→done');
  assertEqual(first.untouched, 1, 'board-shaped entry untouched');

  const rawOpen = JSON.parse(__fs_read(`${dir}/req_0001.json`)!) as Record<string, unknown>;
  assertEqual(rawOpen.status, 'new', 'on-disk status mapped');
  assertEqual(rawOpen.text, LEGACY_OPEN.text, 'text untouched');
  assertEqual(rawOpen.events, undefined, 'migration invents no history');
  const rawResolved = JSON.parse(__fs_read(`${dir}/req_0002.json`)!) as Record<string, unknown>;
  assertEqual(rawResolved.status, 'done', 'resolved maps to done');
  assertEqual(rawResolved.resolution, PARAGRAPH, 'resolution fields untouched');

  const second = migrateBoard(dir);
  assertEqual(second.migrated, 0, 'second run is a no-op');
  assertEqual(second.untouched, 3, 'everything already board-shaped');
});

// ── the board fold: dispatch exemption ───────────────────────────────────────

test('boardColumns EXCLUDES supervisor dispatches by default — records, not jobs', () => {
  const dir = freshDir('boardfold');
  logRequest(dir, 'JOB: a real job sitting in new', 'pane-1');
  logRequest(dir, 'SUPERVISOR — dispatch text, a record whose marker tracks resolution', DISPATCH_ORIGIN);
  const claimed = logRequest(dir, 'JOB: a claimed job', 'pane-2');
  moveRequest(dir, claimed.id, 'doing', { by: 'w' });

  const columns = boardColumns(loadRequests(dir));
  assertEqual(columns.new.length, 1, 'a dispatch-origin entry never appears in default board output');
  assert(columns.new.every((r) => r.origin !== DISPATCH_ORIGIN), 'NEW column is dispatch-free');
  assertEqual(columns.doing.length, 1, 'real jobs land in their columns');
  assertEqual(columns.review.length + columns.done.length, 0, 'nothing else invented');

  const withDispatches = boardColumns(loadRequests(dir), true);
  assertEqual(withDispatches.new.length, 2, '--all is the only door to the dispatch records');
});

// ── the scope gate: one-offs (REQSCOPE-0705) ─────────────────────────────────

test('markOneOff drops an unrelated ask off the board: origin flips, record and ask stay', () => {
  const dir = freshDir('oneoff');
  const unrelated = logRequest(dir, 'hey can you check my resume pdf and fix the formatting real quick', 'session:abc12345');
  const job = logRequest(dir, 'JOB: the mesa tops still eat placements on storey 3', 'session:abc12345');

  const dropped = markOneOff(dir, unrelated.id, 'worker-scope');
  assertEqual(dropped.origin, ONEOFF_ORIGIN, 'origin flips to one-off');
  assertEqual(dropped.text, unrelated.text, 'the ask is untouched — verbatim as ever');
  assertEqual(dropped.status, 'new', 'status untouched — the exemption is the origin, not a state');
  const lastEvent = dropped.events![dropped.events!.length - 1];
  assertEqual(lastEvent.kind, 'note', 'the drop-off appends a note event');
  assertEqual(lastEvent.actor, 'worker-scope', 'the event records who made the scope call');
  assert(isOffBoard(dropped), 'one-offs are off-board');
  assert(!isOffBoard(loadRequests(dir).find((r) => r.id === job.id)!), 'real jobs stay on-board');

  // the board fold hides one-offs exactly like dispatches
  const columns = boardColumns(loadRequests(dir));
  assertEqual(columns.new.map((r) => r.id).join(','), job.id, 'the one-off left every default column');
  assertEqual(boardColumns(loadRequests(dir), true).new.length, 2, '--all still shows the record');

  // idempotent no-op + guards
  const again = markOneOff(dir, unrelated.id, 'worker-scope');
  assertEqual((again.events ?? []).length, dropped.events!.length, 'already-one-off is a no-op — no event spam');
  assertThrows(() => markOneOff(dir, 'req_9999', 'w'), 'unknown id rejected');
  assertThrows(() => markOneOff(dir, unrelated.id, '  '), 'missing actor rejected');
  moveRequest(dir, job.id, 'done', { by: 'supervisor', note: 'closing for the terminal guard' });
  assertThrows(() => markOneOff(dir, job.id, 'w'), 'done entries cannot be amended');
});

// ── oracle match ──────────────────────────────────────────────────────────────

test('oracle ranks entries by verbatim ask text and by resolution words', () => {
  const dir = freshDir('oracle');
  logRequest(dir, 'the cursor ring should be the dab footprint at any zoom', 'pane-paint');
  const other = logRequest(dir, 'tabs should reopen in their last order', 'pane-shell');
  moveRequest(dir, other.id, 'doing', { by: 'w' });
  moveRequest(dir, other.id, 'review', { by: 'w', para: `Reordered workspace persistence so reopened tabs restore their previous arrangement; the session file now records tab order and the shell replays it on boot. ${PARAGRAPH}`, shas: ['1234abcd'] });

  const requests = loadRequests(dir);

  const byAsk = searchRequests(tokenize('cursor ring dab footprint'), requests);
  assert(byAsk.length > 0, 'verbatim ask text matches');
  assertEqual(byAsk[0].item.id, 'req_0001', 'ask-text match ranks the right entry first');

  const byResolution = searchRequests(tokenize('workspace persistence arrangement'), requests);
  assert(byResolution.length > 0, 'resolution paragraph matches');
  assertEqual(byResolution[0].item.id, other.id, 'resolution match ranks the reviewed entry first');
  assertEqual(byResolution[0].item.status, 'review', 'match carries board status');
  assertEqual((byResolution[0].item.shas ?? []).join(','), '1234abcd', 'match carries shas');

  assertEqual(searchRequests(tokenize('quaternion skybox raytracer'), requests).length, 0, 'unrelated query matches nothing');
});

// ── hook capture: BLANKET, restored by REQSEC-0607 ───────────────────────────

const SESSION = 'abc12345-6789-dead-beef-000000000001';

test('blanket capture: every substantive prompt logs verbatim, landing in new', () => {
  const dir = freshDir('blanket');
  const literal = 'please make the voxel editor respect the same camera convention as the test route';
  const result = hookCapturePrompt(dir, SESSION, literal, DEFAULT_LEDGER_CONFIG);
  assertEqual(result.action, 'logged', 'substantive prompt is captured — no marker required (REQSEC-0607)');
  const record = loadRequests(dir)[0];
  assertEqual(record.text, literal, 'prompt stored verbatim');
  assertEqual(record.status, 'new', 'capture lands in new');
  assertEqual(record.sessionId, SESSION, 'sessionId stored (the report key)');
  assertEqual(record.captureMode, 'hook', 'captureMode marks the auto path');
  assertEqual(record.origin, `session:${SESSION.slice(0, 8)}`, 'origin derives from session');
  assertEqual(record.tags, undefined, 'capture never waits on the secretary — entries are born untagged');
});

test('machine prompts NEVER ledger: the secretary feedback loop is dead at the capture gate', () => {
  // USER FINDING: "infinite loop of this incoming" — the app's claude_code
  // workers run in this cwd, so the capture hook fires on THEIR prompts;
  // capturing the secretary's prompt feeds it back into its own next batch
  const dir = freshDir('machine');
  const machinePrompts = [
    `${SECRETARY_PROMPT_PREFIX} Categorize each entry below with short\nlowercase kebab-case tags. ENTRIES:\nreq_0001: whatever`,
    // the REAL handoff shape (req_0211/0212): YAML frontmatter across lines
    '---\nhandoff_version: 1\noriginal_conversation_id: d3e600d5-0069-46ee-baf8\nchain:\n  - session: d3e600d5\nnote: scoped design',
    '--- handoff_version: 1 original_conversation_id: d3e600d5 (the flattened variant)',
    'You drive a live, hot-reloaded 3D viewer by writing ONE file. Whenever I ask for a scene…',
  ];
  for (const prompt of machinePrompts) {
    const result = hookCapturePrompt(dir, SESSION, prompt, DEFAULT_LEDGER_CONFIG);
    assertEqual(result.action, 'skipped', `machine prompt skipped: ${JSON.stringify(prompt.slice(0, 40))}`);
    assert((result as { reason: string }).reason.includes('machinePrefixes'), 'the skip names the gate');
  }
  assertEqual(loadRequests(dir).length, 0, 'machine prompts leave the ledger untouched — no feedback loop');
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

test('SUPERVISOR-prefixed prompts capture as dispatches: exempt origin, field-fill amendment', () => {
  const dir = freshDir('dispatch');
  const dispatchText = 'SUPERVISOR — SOMETHING-0607 dispatch: do a large thing across several files with a marker tracking it.';
  const captured = hookCapturePrompt(dir, SESSION, dispatchText, DEFAULT_LEDGER_CONFIG);
  assertEqual(captured.action, 'logged', 'dispatches are still captured — the durable record is welcome');
  const record = loadRequests(dir)[0];
  assertEqual(record.origin, DISPATCH_ORIGIN, 'dispatch origin replaces session:<id8>');
  assertEqual(record.text, dispatchText, 'verbatim as ever');
  assertEqual(record.sessionId, SESSION, 'session key kept for the report');

  // mis-captures amend by field-fill: origin flips, the ask is untouched
  const mis = hookCapturePrompt(dir, SESSION, 'supervisor-shaped text captured without the prefix, long enough to log.', DEFAULT_LEDGER_CONFIG);
  const amended = markDispatch(dir, (mis as { record: RequestRecord }).record.id);
  assertEqual(amended.origin, DISPATCH_ORIGIN, 'amendment flips origin');
  assertEqual(amended.text, 'supervisor-shaped text captured without the prefix, long enough to log.', 'amendment never touches the ask');
  const closed = moveRequest(dir, record.id, 'done', { by: 'supervisor', note: 'dispatch record, marker tracks it' });
  assertThrows(() => markDispatch(dir, closed.id), 'done entries cannot be amended');
});

test('requestsForSession groups a session\'s asks — the stop hook scans only its doing entries', () => {
  const dir = freshDir('session');
  hookCapturePrompt(dir, SESSION, 'first substantive ask, long enough to clear the bar', DEFAULT_LEDGER_CONFIG);
  hookCapturePrompt(dir, 'ffff0000-0000-0000-0000-000000000099', 'other session ask, also long enough to clear the bar', DEFAULT_LEDGER_CONFIG);
  logRequest(dir, 'manually relayed ask for the same session', 'supervisor-relay', { sessionId: SESSION });
  const mine = requestsForSession(dir, SESSION);
  assertEqual(mine.length, 2, 'hook + manual entries group by sessionId');
  assert(mine.every((record) => record.sessionId === SESSION), 'only this session\'s entries');
  assertEqual(mine.filter((record) => record.status === 'doing').length, 0, 'nothing claimed yet — the stop nudge stays silent');
  moveRequest(dir, mine[0].id, 'doing', { by: 'worker-s' });
  assertEqual(requestsForSession(dir, SESSION).filter((record) => record.status === 'doing').length, 1, 'the stop-hook scan sees the claimed entry');
});

// ── the SECRETARY: tags (REQSEC-0607) ────────────────────────────────────────

test('tagRequest persists by union: normalized, deduped, append-only — organization only', () => {
  const dir = freshDir('tags');
  const job = logRequest(dir, 'the camera feels too slippery when aiming, tighten it', 'pane-3');
  const tagged = tagRequest(dir, job.id, [' Bug ', 'ux', 'UX']);
  assertEqual(tagged.tags!.join(','), 'bug,ux', 'tags normalize (trim, lowercase) and dedupe');
  const onDisk = loadRequests(dir)[0];
  assertEqual(onDisk.tags!.join(','), 'bug,ux', 'tags persist through the same store door');
  assertEqual(onDisk.status, 'new', 'tagging never touches status');
  assertEqual(onDisk.text, 'the camera feels too slippery when aiming, tighten it', 'never touches the ask');

  const again = tagRequest(dir, job.id, ['perf-log', 'bug']);
  assertEqual(again.tags!.join(','), 'bug,ux,perf-log', 'union — existing tags never removed');
  assertThrows(() => tagRequest(dir, 'req_9999', ['bug']), 'unknown id rejected');
});

test('unsure model → untouched: empty, junk, and already-known tags are all no-ops', () => {
  const dir = freshDir('unsure');
  const job = logRequest(dir, 'an ask the model could not categorize with any confidence', 'pane-4');
  const before = JSON.parse(__fs_read(`${dir}/${job.id}.json`)!);
  tagRequest(dir, job.id, []);                                  // model returned nothing
  tagRequest(dir, job.id, ['', '  ', 'NOT A TAG!!', 'x'.repeat(40)]); // junk only
  tagRequest(dir, job.id, 'not-an-array' as unknown as string[]);     // malformed reply shape
  const after = JSON.parse(__fs_read(`${dir}/${job.id}.json`)!);
  assertEqual(JSON.stringify(after), JSON.stringify(before), '"if model doesnt know they dont do nada" — the file is byte-identical');
  assertEqual(loadRequests(dir)[0].tags, undefined, 'no tags field invented');
});

test('search by tag: filterByTag + allTags drive board --tag / list --tag', () => {
  const dir = freshDir('tagsearch');
  const a = logRequest(dir, 'clicking the up arrow duplicates the painted layer', 'pane-1');
  const b = logRequest(dir, 'here is the perf log from the idle spike, frames attached', 'pane-2');
  logRequest(dir, 'untagged third ask that no search should surface', 'pane-3');
  tagRequest(dir, a.id, ['bug', 'ux']);
  tagRequest(dir, b.id, ['perf-log']);
  const records = loadRequests(dir);
  assertEqual(filterByTag(records, 'bug').map((r) => r.id).join(','), a.id, 'tag search finds exactly the tagged entry');
  assertEqual(filterByTag(records, 'PERF-LOG ').map((r) => r.id).join(','), b.id, 'search needle normalizes too');
  assertEqual(filterByTag(records, 'quaternion').length, 0, 'unknown tag matches nothing');
  assertEqual(allTags(records).join(','), 'bug,perf-log,ux', 'allTags is the sorted union in use');
  // tags ride the board fold without changing it: a tagged entry still sits in its column
  const columns = boardColumns(filterByTag(records, 'bug'));
  assertEqual(columns.new.length, 1, 'board --tag = filter then the same fold');
  assert(SEED_TAGS.includes('bug') && SEED_TAGS.includes('perf-log'), 'seed vocabulary covers the basics');
});

test('tags never bend the board: states, resolve discipline, and the user gate are untouched', () => {
  const dir = freshDir('tagsafe');
  const job = logRequest(dir, 'tagged work still walks the same board as everything else', 'pane-5');
  tagRequest(dir, job.id, ['ask']);
  moveRequest(dir, job.id, 'doing', { by: 'w' });
  assertThrows(() => moveRequest(dir, job.id, 'done', { by: 'user' }), 'tags grant no shortcuts — doing→done still illegal');
  moveRequest(dir, job.id, 'review', { by: 'w', para: PARAGRAPH, shas: [] });
  assertThrows(() => moveRequest(dir, job.id, 'done', { by: 'secretary' }), 'the secretary may NEVER accept — review→done stays user-only');
  const done = moveRequest(dir, job.id, 'done', { by: 'user' });
  assertEqual(done.tags!.join(','), 'ask', 'tags survive the whole walk');
  const after = tagRequest(dir, job.id, ['ruling']);
  assertEqual(after.status, 'done', 'tagging a done entry changes nothing but tags — organization only');
});

// cases run inside finish(), so cleanup must be the last CASE — a plain
// __fs_remove here would run before any test created its dir.
test('cleanup: temp ledger dirs removed', () => {
  assert(__fs_remove(TMP), 'temp dir removed');
});

finish('requests');
