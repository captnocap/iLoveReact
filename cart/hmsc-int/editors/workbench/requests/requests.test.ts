// editors/workbench/requests/requests.test.ts — P4 behavior suite for the
// REQUEST BOARD WorkbenchSource (REQPANEL-0606 → REQBOARD-0607 → the
// master-detail swap → REQSEC-0607 secretary).
//
// Consumption-layer, against the REAL machinery: the store's deps are the
// actual docs/game/_index/requests.ts functions over a temp ledger dir —
// the SAME module tools/request runs. What these tests prove end to end:
// the LIST lives in the narrow column (rows select), the wide DETAIL carries
// the FULL ask/resolution/history + the board verbs (review→done user-gated),
// tags persist through the one store door and are searchable as views, and
// the secretary's unsure/absent paths leave everything byte-untouched.
//
//   tools/esbuild cart/hmsc-int/editors/workbench/requests/requests.test.ts \
//     --bundle --outfile=zig-out/game/tests/wb_requests.test.js --format=iife \
//     --platform=neutral --target=es2022 --alias:@reactjit=runtime \
//     --alias:@game=cart/hmsc-int/game
//   tools/v8cli zig-out/game/tests/wb_requests.test.js

import { assert, assertEqual, assertThrows, finish, test } from '../../../game/_testkit';
import {
  DEFAULT_LEDGER_CONFIG,
  DISPATCH_ORIGIN,
  MIN_RESOLUTION_CHARS,
  hookCapturePrompt,
  loadRequests,
  logRequest,
  markOneOff,
  moveRequest,
  noteRequest,
  tagRequest,
} from '../../../../../docs/game/_index/requests';
import { createRequestsStore, USER_CLICK_RESOLUTION, type RequestsStore } from './store';
import {
  askPreview, boardSections, cardPreview, requestDetail, requestRows,
  requestsActions, requestsPanel, requestsRoster, shortStamp,
} from './panel';
import { buildSecretaryPrompt, parseSecretaryReply, nextBatch, untaggedEntries, SECRETARY_BATCH } from './secretary';

declare const __fs_mkdir: (path: string) => boolean;
declare const __fs_remove: (path: string) => boolean;
declare const __fs_read: (path: string) => string | null;

function realFixture(name = ''): { store: RequestsStore; dir: string; ids: string[] } {
  const dir = `/tmp/reactjit-reqpanel-test-${Date.now()}${name}`;
  __fs_mkdir(dir);
  const ids = [
    logRequest(dir, 'make the doors open when i walk up to them, every building', 'pane-3').id,
    logRequest(dir, 'the camera feels too slippery when aiming, tighten it', 'session:abcd1234').id,
    logRequest(dir, 'SUPERVISOR DISPATCH — MARKER-0606, do the thing', DISPATCH_ORIGIN).id,
  ];
  const store = createRequestsStore({
    load: () => loadRequests(dir),
    move: (id, to, input) => moveRequest(dir, id, to, input),
    tag: (id, tags) => tagRequest(dir, id, tags),
    note: (id, by, text) => noteRequest(dir, id, by, text),
    error: null,
  });
  return { store, dir, ids };
}

test('UNRESOLVED is the default lens on what is left: board-open asks, newest first, dispatches hidden', () => {
  const { store, dir } = realFixture();
  const rows = store.rowsFor('unresolved');
  assertEqual(rows.length, 2, 'two unresolved asks; the dispatch never shows by default (the list --open rule)');
  assertEqual(rows[0].text, 'the camera feels too slippery when aiming, tighten it', 'newest first');
  assertEqual(store.rowsFor('dispatches').length, 1, 'dispatches live behind their own view');
  assertEqual(store.rowsFor('all').length, 2, "'all asks' stays dispatch-free too");
  const counts = store.counts();
  assertEqual(`${counts.unresolved}/${counts.resolved}/${counts.all}/${counts.dispatches}`, '2/0/2/1', 'live counts');
  assert(__fs_remove(dir), 'cleanup');
});

test('ONE-OFFS (REQSCOPE-0705): a dropped-off ask leaves every default view, lives behind its own, gets no verbs', () => {
  const { store, dir, ids } = realFixture('-oneoff');
  markOneOff(dir, ids[1], 'worker-scope'); // the camera ask judged unrelated (for the test)
  assertEqual(store.rowsFor('unresolved').length, 1, 'the one-off left the default lens');
  assertEqual(store.rowsFor('all').length, 1, "'all asks' stays one-off-free too");
  assertEqual(store.rowsFor('one-offs').map((r) => r.id).join(','), ids[1], 'one-offs live behind their own view');
  assertEqual(store.rowsFor('dispatches').length, 1, 'dispatches and one-offs are separate views');
  assertEqual(store.counts()['one-offs'], 1, 'the one-offs chip counts live');
  store.select(ids[1]);
  assertEqual(requestDetail(store).verbs.length, 0, 'one-offs offer no board verbs — records, not jobs');
  assertEqual(requestsActions(store, 'one-offs').length, 0, 'no hero verb on a one-off');
  assert(__fs_remove(dir), 'cleanup');
});

test('THE CLICK: mark resolved drives the REAL board moves — the JSON on disk flips', () => {
  const { store, dir, ids } = realFixture();
  const resolved = store.markResolvedByUser(ids[0]);
  assertEqual(resolved.status, 'done', 'the record flips');
  assertEqual(resolved.resolution, USER_CLICK_RESOLUTION, 'the paragraph says the user resolved it via the interface');
  assert(USER_CLICK_RESOLUTION.length >= MIN_RESOLUTION_CHARS, 'the click paragraph clears the ledger\'s own bar');
  const onDisk = loadRequests(dir).find((r) => r.id === ids[0])!;
  assertEqual(onDisk.status, 'done', 'the ledger entry itself changed — no parallel status store');
  assertEqual(store.rowsFor('unresolved').length, 1, 'what-is-left shrank');
  assertEqual(store.rowsFor('resolved').length, 1, 'the resolved view gained it');
  assertThrows(() => store.markResolvedByUser(ids[0]), 'one-way: a second close-now is refused by the ledger itself');
  assert(__fs_remove(dir), 'cleanup');
});

// ── the master-detail SWAP (the user's layout verdict) ───────────────────────

test('THE LIST is column 3: board sections as groups, rows select, truncation welcome', () => {
  const { store, dir, ids } = realFixture();
  moveRequest(dir, ids[1], 'doing', { by: 'worker-1' });
  const spec = requestsPanel(store, 'all');
  assertEqual(spec.groups.map((g) => g.title).join(','), 'NEW · 1,DOING · 1', 'sections with counts; empty sections cost no rail space');
  const row = spec.groups[0].fields[0] as any;
  assertEqual(row.t, 'act', 'a list row is a click');
  assert(String(row.k).startsWith(`${ids[0]} ·`), 'row reads id + truncated preview');
  row.run();
  assertEqual(store.selectedId(), ids[0], 'clicking a row SELECTS — selection is view state, never an edit');
  const reSpec = requestsPanel(store, 'all');
  assert(String((reSpec.groups[0].fields[0] as any).k).startsWith('▶ '), 'the selected row is marked');
  (reSpec.groups[0].fields[0] as any).run();
  assertEqual(store.selectedId(), null, 'clicking again deselects');
  const empty = requestsPanel(store, 'resolved');
  assert(String((empty.groups[0].fields[0] as any).get()).includes('no entries'), 'empty view says so');
  assert(__fs_remove(dir), 'cleanup');
});

test('THE DETAIL is the wide stage: full verbatim ask, resolution, history — selecting an entry shows EVERYTHING', () => {
  const dir = `/tmp/reactjit-reqpanel-test-${Date.now()}-detail`;
  __fs_mkdir(dir);
  const longAsk = `a wall of text far longer than any one-line value chip could hold ${'x'.repeat(300)}\nline two\nline three\nline four\nline five — every line matters`;
  const logged = logRequest(dir, longAsk, 'pane-9');
  const store = createRequestsStore({
    load: () => loadRequests(dir),
    move: (id, to, input) => moveRequest(dir, id, to, input),
    tag: (id, tags) => tagRequest(dir, id, tags),
    note: (id, by, text) => noteRequest(dir, id, by, text),
    error: null,
  });
  assertEqual(requestDetail(store).hint, 'click an ask in the list', 'no selection → the hint');
  store.select(logged.id);
  let detail = requestDetail(store);
  assertEqual(detail.record!.text, longAsk, 'the FULL text, byte-equal — no truncation in the detail');
  store.moveByUser(logged.id, 'doing');
  store.moveByUser(logged.id, 'review');
  detail = requestDetail(store);
  assertEqual(detail.record!.resolution, USER_CLICK_RESOLUTION, 'the resolution paragraph in full');
  assertEqual(detail.events.filter((e) => e.kind === 'state').length, 2, 'the history rides the detail');
  assert(__fs_remove(dir), 'cleanup');
});

test('the detail\'s verbs are the BOARD MOVES: claim → review → accept, one legal step, user-gated done', () => {
  const { store, dir, ids } = realFixture();
  store.select(ids[0]);
  let detail = requestDetail(store);
  assertEqual(detail.verbs.map((v) => v.k).join(','), 'claim → doing', 'new offers exactly the claim');
  detail.verbs[0].run();
  assertEqual(store.record(ids[0])!.status, 'doing', 'claim moves new→doing');
  assertEqual(requestsActions(store, 'unresolved')[0].label, '→ review', 'the hero verb mirrors the next move');
  detail = requestDetail(store);
  assertEqual(detail.verbs.map((v) => v.k).join(','), 'finish → review', 'doing offers exactly the review move');
  detail.verbs[0].run();
  detail = requestDetail(store);
  assertEqual(detail.verbs.map((v) => v.k).join(','), '✓ accept → done,↩ bounce → new', 'review offers accept + bounce');
  detail.verbs[0].run();
  const done = store.record(ids[0])!;
  assertEqual(done.status, 'done', 'accept moves review→done');
  assertEqual(done.events![done.events!.length - 1].actor, 'user', 'acceptance carries the user\'s word — review→done stays user-gated');
  detail = requestDetail(store);
  assertEqual(detail.verbs.length, 0, 'done is terminal — no verbs');
  assert(String(detail.terminal).includes('terminal'), 'the detail says so instead of inventing unresolve');
  assertEqual(requestsActions(store, 'unresolved').length, 0, 'no hero verb on done');
  assert(__fs_remove(dir), 'cleanup');
});

test('bounce sends review back to new; a dispatch gets no verbs at all (record, not job)', () => {
  const { store, dir, ids } = realFixture();
  store.select(ids[1]);
  store.moveByUser(ids[1], 'doing');
  store.moveByUser(ids[1], 'review');
  const detail = requestDetail(store);
  detail.verbs[1].run(); // ↩ bounce → new
  const bounced = store.record(ids[1])!;
  assertEqual(bounced.status, 'new', 'bounce moves review→new');
  assertEqual(bounced.resolution, USER_CLICK_RESOLUTION, 'the once-filled resolution survives the bounce');
  store.select(ids[2]); // the dispatch
  assertEqual(requestDetail(store).verbs.length, 0, 'dispatches offer no board verbs');
  assertEqual(requestsActions(store, 'dispatches').length, 0, 'no hero verb on a dispatch');
  assert(__fs_remove(dir), 'cleanup');
});

// ── tags: views, chips, search (REQSEC-0607) ─────────────────────────────────

test('tags become views: #chips on the roster, tag: views filter, counts live', () => {
  const { store, dir, ids } = realFixture();
  store.applyTags(ids[0], ['bug', 'ux']);
  store.applyTags(ids[1], ['perf-log']);
  const roster = requestsRoster(store);
  assertEqual(roster[0].id, 'unresolved', 'fixed views lead, unresolved first (the default row)');
  assertEqual(roster.filter((r) => String(r.id).startsWith('tag:')).map((r) => r.label).join(','), '#bug · 1,#perf-log · 1,#ux · 1', 'a #chip per tag in use, with counts');
  assertEqual(store.rowsFor('tag:bug').map((r) => r.id).join(','), ids[0], 'a tag view is the search');
  assertEqual(store.rowsFor('tag:quaternion').length, 0, 'unknown tag matches nothing');
  const sections = boardSections(store, 'tag:bug');
  assertEqual(sections.map((s) => s.title).join(','), 'NEW,DOING,REVIEW,DONE', 'tag views board like everything else');
  assertEqual(sections[0].rows[0].id, ids[0], 'the tagged entry sits in its true column');
  assertEqual(requestRows(store, 'all')[1].tags.join(','), 'bug,ux', 'tags ride the row fold');
  const onDisk = loadRequests(dir).find((r) => r.id === ids[0])!;
  assertEqual(onDisk.tags!.join(','), 'bug,ux', 'applyTags persists through the SAME tagRequest door — no parallel tag store');
  assertEqual(onDisk.status, 'new', 'tags are organization only');
  assert(__fs_remove(dir), 'cleanup');
});

// ── the secretary protocol (REQSEC-0607) ─────────────────────────────────────

test('the secretary batches untagged entries into one strict-JSON turn', () => {
  const { store, dir, ids } = realFixture();
  store.applyTags(ids[1], ['ux']);
  const records = loadRequests(dir);
  const batch = untaggedEntries(records);
  assertEqual(batch.map((r) => r.id).join(','), `${ids[0]},${ids[2]}`, 'only untagged entries queue (dispatches get organized too)');
  assert(batch.length <= SECRETARY_BATCH, 'one bounded turn');
  const prompt = buildSecretaryPrompt(batch);
  assert(prompt.includes(`${ids[0]}: make the doors open`), 'entries ride the prompt id-first');
  assert(prompt.includes('bug, perf-log, ask, ruling, ux, idea'), 'the seed vocabulary is spelled out');
  assert(prompt.includes('OMIT it entirely'), 'unsure → omit is the contract');
  assert(__fs_remove(dir), 'cleanup');
});

test('a run drains the WHOLE queue in bounded batches; unsure entries never re-queue within a run', () => {
  // USER FINDING: "225 untagged and then running it says 10/12" — one click
  // must batch through everything, not stop after one turn of 12.
  const dir = `/tmp/reactjit-reqpanel-test-${Date.now()}-drain`;
  __fs_mkdir(dir);
  const total = SECRETARY_BATCH * 2 + 3; // forces 3 batches
  for (let i = 0; i < total; i += 1) logRequest(dir, `untagged ask number ${i} with enough words to matter`, 'pane-x');
  const store = createRequestsStore({
    load: () => loadRequests(dir),
    move: (id, to, input) => moveRequest(dir, id, to, input),
    tag: (id, tags) => tagRequest(dir, id, tags),
    note: (id, by, text) => noteRequest(dir, id, by, text),
    error: null,
  });
  // simulate the run loop: each turn tags all but one entry (the model stays
  // unsure about the batch's first id), which gets marked attempted
  const attempted = new Set<string>();
  let turns = 0;
  let tagged = 0;
  for (;;) {
    const batch = nextBatch(loadRequests(dir), attempted);
    if (batch.length === 0) break;
    assert(batch.length <= SECRETARY_BATCH, 'every turn stays bounded');
    turns += 1;
    assert(turns <= total, 'the loop terminates'); // runaway guard for the test itself
    for (const record of batch.slice(1)) { tagRequest(dir, record.id, ['ask']); tagged += 1; }
    for (const record of batch) attempted.add(record.id); // unsure first entry included
  }
  assertEqual(turns, 3, 'the queue drains across exactly the expected batches');
  assertEqual(tagged, total - 3, 'everything the model was confident about got tagged');
  const stillUntagged = untaggedEntries(loadRequests(dir), Infinity);
  assertEqual(stillUntagged.length, 3, 'the unsure entries stay untouched (nada) …');
  assertEqual(nextBatch(loadRequests(dir), attempted).length, 0, '… and never re-queue within the run');
  assertEqual(nextBatch(loadRequests(dir), new Set()).length, 3, 'a FRESH run may retry them');
  assert(__fs_remove(dir), 'cleanup');
});

test('THE FEEDBACK LOOP IS DEAD: the secretary\'s own prompt is never captured, never re-batched', () => {
  // USER FINDING, verbatim: "Lmao. infinite loop of this incoming" — the
  // secretary's claude_code worker runs in this cwd, so the repo capture
  // hook fired on the secretary's OWN prompt; the captured prompt then
  // queued untagged into the next batch, forever.
  const { dir, ids } = realFixture('-loop');
  const prompt = buildSecretaryPrompt(loadRequests(dir));
  // 1) the capture gate skips the prompt outright
  const captured = hookCapturePrompt(dir, 'aaaa1111-2222-3333-4444-555566667777', prompt, DEFAULT_LEDGER_CONFIG);
  assertEqual(captured.action, 'skipped', 'the secretary prompt never enters the ledger');
  assertEqual(loadRequests(dir).length, 3, 'ledger unchanged');
  // 2) even a pre-gate echo already sitting in the ledger never re-batches
  logRequest(dir, prompt, 'session:894793de'); // simulate the old mis-capture
  const queue = untaggedEntries(loadRequests(dir), Infinity);
  assert(queue.every((record) => record.id !== 'req_0004'), 'machine echoes are excluded from every batch');
  assertEqual(queue.length, ids.length, 'the real asks still queue');
  assert(__fs_remove(dir), 'cleanup');
});

test('the user can COMMENT: noteByUser appends to the history as actor user, any state, even done', () => {
  // USER ASK, verbatim: "leave comments on things so that it can be used as
  // a place i can go through and say if it is correct or not"
  const { store, dir, ids } = realFixture('-comment');
  store.select(ids[0]);
  store.noteByUser(ids[0], 'this one is correct, doors feel right now');
  let detail = requestDetail(store);
  const note = detail.events[detail.events.length - 1];
  assertEqual(note.kind, 'note', 'a comment is a note event');
  assertEqual(note.actor, 'user', 'carried as the user\'s word');
  assertEqual(note.text, 'this one is correct, doors feel right now', 'verbatim');
  // comments persist through the SAME noteRequest door — visible on disk
  const onDisk = loadRequests(dir).find((r) => r.id === ids[0])!;
  assertEqual(onDisk.events![onDisk.events!.length - 1].text, 'this one is correct, doors feel right now', 'no parallel comment store');
  // even done entries can gather the user's verdict
  store.markResolvedByUser(ids[0]);
  store.noteByUser(ids[0], 'confirmed after the fact — still correct');
  detail = requestDetail(store);
  assertEqual(detail.events[detail.events.length - 1].text, 'confirmed after the fact — still correct', 'done entries still take comments');
  assertThrows(() => store.noteByUser('req_9999', 'nope'), 'unknown id rejected by the ledger');
  assert(__fs_remove(dir), 'cleanup');
});

test('reply parsing: confident tags apply; unsure/garbage/invented → nada, entries byte-untouched', () => {
  const { store, dir, ids } = realFixture();
  const batchIds = [ids[0], ids[1]];
  // a real reply, with prose noise around the JSON — tolerated
  const good = parseSecretaryReply(`Sure! Here you go:\n{"${ids[0]}": ["Bug", "ux"], "${ids[1]}": []}\nDone.`, batchIds);
  assertEqual(JSON.stringify(good), `{"${ids[0]}":["bug","ux"]}`, 'tags normalize; empty arrays drop (unsure → omitted)');
  // garbage replies parse to {} — the model-absent / model-failed path
  assertEqual(JSON.stringify(parseSecretaryReply('no json here at all', batchIds)), '{}', 'prose-only → nada');
  assertEqual(JSON.stringify(parseSecretaryReply('{broken json', batchIds)), '{}', 'malformed → nada');
  assertEqual(JSON.stringify(parseSecretaryReply('["an","array"]', batchIds)), '{}', 'wrong shape → nada');
  assertEqual(JSON.stringify(parseSecretaryReply('{"req_9999": ["bug"]}', batchIds)), '{}', 'an invented id → nada');
  // nada means BYTE-untouched on disk
  const before = __fs_read(`${dir}/${ids[0]}.json`)!;
  for (const [id, tags] of Object.entries(parseSecretaryReply('total model meltdown', batchIds))) store.applyTags(id, tags);
  assertEqual(__fs_read(`${dir}/${ids[0]}.json`)!, before, '"if model doesnt know they dont do nada"');
  // the confident path persists through the real door
  for (const [id, tags] of Object.entries(good)) store.applyTags(id, tags);
  assertEqual(loadRequests(dir).find((r) => r.id === ids[0])!.tags!.join(','), 'bug,ux', 'confident tags land');
  assert(__fs_remove(dir), 'cleanup');
});

test('model absent: the board works untagged — capture, views, moves all indifferent to the secretary', () => {
  const { store, dir, ids } = realFixture();
  // nobody ever ran the secretary: no tags anywhere
  assertEqual(store.tagsInUse().length, 0, 'no tags in use');
  assertEqual(requestsRoster(store).length, 5, 'roster is just the fixed views (incl. one-offs, REQSCOPE-0705) — no phantom chips');
  store.moveByUser(ids[0], 'doing');
  store.moveByUser(ids[0], 'review');
  store.moveByUser(ids[0], 'done');
  assertEqual(store.record(ids[0])!.status, 'done', 'the whole board walk works with zero tags');
  assert(__fs_remove(dir), 'cleanup');
});

// ── folds + previews (kept from the readability verdicts) ────────────────────

test('cards wrap REAL text — never a one-line ellipsis (the user\'s readability verdict)', () => {
  const ask = 'fix the door so it opens\nand make the hinge quiet\nthird line of detail\nfourth line\nfifth line never shows';
  const card = cardPreview(ask);
  assert(card.includes('fix the door so it opens\nand make the hinge quiet'), 'real lines survive, newlines intact');
  assert(card.includes('fourth line'), 'up to four lines of the ask show');
  assert(!card.includes('fifth line'), 'the tail is cut, not the body');
  assert(card.endsWith('…'), 'truncation is honest — at the END of real text');
  assertEqual(cardPreview('x'.repeat(400)).length, 240, 'long asks keep a wrapping paragraph-sized chunk');
  assertEqual(cardPreview('short ask'), 'short ask', 'short asks show whole');
});

test('the stage fold: row views carry stamp/origin/status/preview; boardSections stay dispatch-free', () => {
  const { store, dir, ids } = realFixture();
  moveRequest(dir, ids[1], 'doing', { by: 'worker-1' });
  const rows = requestRows(store, 'unresolved');
  assertEqual(rows[1].id, ids[0], 'oldest last');
  assertEqual(rows[1].status, 'new', 'status rides the row');
  assert(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(rows[1].stamp), 'date reads YYYY-MM-DD HH:MM');
  const sections = boardSections(store, 'all');
  assertEqual(sections.map((s) => s.title).join(','), 'NEW,DOING,REVIEW,DONE', 'all four sections, board order');
  assert(sections.flatMap((s) => s.rows).every((r) => r.id !== ids[2]), 'the dispatch record is OFF the board');
  assertEqual(boardSections(store, 'unresolved').map((s) => s.title).join(','), 'NEW,DOING,REVIEW', 'unresolved shows what is left');
  assertEqual(askPreview('first line of the ask\nsecond line'), 'first line of the ask', 'preview is the first line');
  assertEqual(shortStamp('2026-06-07T04:37:02.385Z'), '2026-06-07 04:37', 'stamp shape');
  assert(__fs_remove(dir), 'cleanup');
});

test('a broken ledger surfaces, never crashes: empty rows + the named error', () => {
  const store = createRequestsStore({
    load: () => { throw new Error('corrupt ledger entry (bad JSON): req_0666.json'); },
    move: () => { throw new Error('unreachable'); },
    tag: () => { throw new Error('unreachable'); },
    note: () => { throw new Error('unreachable'); },
    error: 'corrupt ledger entry (bad JSON): req_0666.json',
  });
  assertEqual(store.rowsFor('unresolved').length, 0, 'a throwing load reads as empty');
  assertEqual(store.counts().all, 0, 'counts stay zero');
  assert(String(requestDetail(store).hint).includes('unavailable'), 'the detail names the breakage');
  const spec = requestsPanel(store, 'unresolved');
  assert(String((spec.groups[0].fields[0] as any).get()).includes('unavailable'), 'the list names it too');
  assert(!!store.error(), 'the error is reachable for the stage empty-state');
});

finish('workbench/requests');
