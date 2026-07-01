// runtime/buildjournal/buildjournal.test.ts — locks the build-journal data model:
// request → build-number derivation, ledger ingest, thread create/rename (rename
// preserves stableId + every link), attach (bidirectional), and ranked semantic
// search. The clickable dialog is later UI; this proves the model underneath it.
//
//   tools/esbuild runtime/buildjournal/buildjournal.test.ts --bundle \
//     --outfile=/tmp/bj.test.js --format=iife --platform=neutral \
//     --target=es2022 --alias:@reactjit=runtime
//   tools/v8cli /tmp/bj.test.js

import {
  deriveBuildNumber, requestNumber, buildNumberToRequest, BUILD_BASE,
} from './buildNumber';
import { BuildJournal } from './journal';
import type { RequestEntry, LogCapture } from './types';

// ── micro harness (self-contained; the repo has no test framework) ───────────
let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(s + '\n'));
function test(name: string, fn: () => void) {
  try { fn(); passed++; log(`  ok  ${name}`); }
  catch (e) { failed++; log(`FAIL  ${name}: ${(e as Error).message}`); }
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }

// ── inline ledger fixtures (NEVER read real docs/game/_requests files) ───────
const req2163: RequestEntry = {
  id: 'req_2163',
  at: '2026-06-30T09:18:56.294Z',
  origin: 'session:e0080e48',
  text: 'move the rotate to be from middle mouse down only',
  status: 'review',
  events: [
    { at: '2026-06-30T09:19:16Z', actor: 'e008', kind: 'state', from: 'new', to: 'doing' },
    { at: '2026-06-30T09:40:54Z', actor: 'e008', kind: 'state', from: 'doing', to: 'review' },
  ],
  resolution: 'Orbit moved to middle-mouse so left is free for selection.',
  shas: ['c2fcd03f0'],
};
const req0007: RequestEntry = {
  id: 'req_0007',
  origin: 'session:abc',
  text: 'player walks on water again',
  status: 'new',
};

// ── build-number derivation (pure + deterministic) ───────────────────────────
test('deriveBuildNumber maps a request id onto the 1.0.0.<n> stream', () => {
  assert(deriveBuildNumber('req_2163') === '1.0.0.2163', 'req_2163 → 1.0.0.2163');
  assert(deriveBuildNumber('req_0007') === '1.0.0.7', 'leading zeros stripped to the counter');
  assert(deriveBuildNumber(2108) === `${BUILD_BASE}.2108`, 'a raw number works too');
  assert(deriveBuildNumber('req_2163') === deriveBuildNumber('req_2163'), 'deterministic');
});

test('requestNumber/buildNumberToRequest round-trip the counter', () => {
  assert(requestNumber('req_2163') === 2163, 'pulled trailing digit run');
  assert(buildNumberToRequest('1.0.0.2163') === 2163, 'inverted from the stream value');
  assert(Number.isNaN(buildNumberToRequest('2.0.0.5')), 'off-base value is not on the stream');
});

test('a request id with no counter is rejected, not silently zeroed', () => {
  let threw = false;
  try { deriveBuildNumber('req_'); } catch { threw = true; }
  assert(threw, 'no number → throw');
});

// ── ingest: ledger entries → build notes ─────────────────────────────────────
test('ingest turns a resolved ledger entry into a build note with hard evidence', () => {
  const j = new BuildJournal();
  const note = j.ingestRequest(req2163);
  assert(note !== undefined, 'resolved request registers a note');
  const delivered = note!;
  assert(delivered.buildId === '1.0.0.2163', 'buildId derived from request id');
  assert(delivered.agent === 'e008', 'agent is the last state actor');
  assert(delivered.ask.startsWith('move the rotate'), 'ask is the request text — the honest half');
  assert(delivered.summary.startsWith('Orbit moved'), 'summary is the agent claim (resolution)');
  assert(delivered.status === 'review', 'status is the last state transition');
  assert(delivered.commits[0] === 'c2fcd03f0', 'commits carry the sha evidence');
  assert(j.noteByRequest('req_2163') === delivered, 'looked up by request id');
  assert(j.noteByBuild('1.0.0.2163') === delivered, 'looked up by build number');
});

test('an OPEN ask still registers a note — a bug is threadable before it is resolved', () => {
  const j = new BuildJournal();
  const note = j.ingestRequest(req0007);
  assert(note !== undefined, 'unresolved request still registers a note');
  assert(note!.summary === '', 'no claim written yet');
  assert(note!.status === 'new', 'status reflects the open state');
  assert(note!.commits.length === 0, 'nothing shipped — zero commits, honestly');
  assert(j.notes().length === 1, 'the open prompt is in the stream');
  assert(j.latestBuildNumber() === '1.0.0.7', 'an open request advances the build number too');
});

test('a request id with no counter is skipped, not crashed', () => {
  const j = new BuildJournal();
  assert(j.ingestRequest({ id: 'req_', text: 'junk' }) === undefined, 'no counter → no note');
  assert(j.notes().length === 0, 'nothing registered');
});

test('latestBuildNumber tracks the highest request counter ingested', () => {
  const j = new BuildJournal();
  j.ingestRequests([req0007, req2163]);
  assert(j.latestBuildNumber() === '1.0.0.2163', 'newest request leads the stream');
  assert(j.notes()[0]!.requestId === 'req_2163', 'notes() is newest-first');
  assert(j.noteByRequest('req_0007') !== undefined, 'the open request is present, not skipped');
});

// ── threads: create, rename-preserves-links ──────────────────────────────────
test('createThread mints a stable id distinct from the display name', () => {
  const j = new BuildJournal();
  const t = j.createThread({ semanticName: 'jesus water walking', tags: ['physics', 'water'] });
  assert(/^thread_\d{4}$/.test(t.stableId), 'stable id minted');
  assert(t.semanticName === 'jesus water walking', 'semantic name carried');
  assert(t.linkedRequests.length === 0 && t.attachedCaptures.length === 0, 'starts empty');
});

test('renaming a thread preserves its stableId and every link', () => {
  const j = new BuildJournal();
  j.ingestRequest(req2163);
  const t = j.createThread({ semanticName: 'water walk', tags: ['water'] });
  j.attachToThread(t.stableId, { requestId: 'req_2163' });
  const id = t.stableId;

  const renamed = j.renameThread(id, 'jesus water walking');
  assert(renamed.stableId === id, 'stable id unchanged across rename');
  assert(renamed.semanticName === 'jesus water walking', 'name updated');
  assert(renamed.aliases.includes('water walk'), 'old name kept as a searchable alias');
  assert(renamed.linkedRequests.includes('req_2163'), 'links survive the rename');
  // and the back-reference on the note is still intact
  assert(j.noteByRequest('req_2163')!.threadIds.includes(id), 'note still points back at the thread');
});

// ── attach: bidirectional wiring ─────────────────────────────────────────────
test('attachToThread wires request, build, and capture both ways', () => {
  const j = new BuildJournal();
  const note = j.ingestRequest(req2163);
  const cap: LogCapture = {
    id: 'cap_1', name: 'orbit jitter', channels: ['editor.place'],
    timeRange: { start: 0, end: 1000 }, buildId: '1.0.0.2163',
    mapContext: 'modelview', note: 'middle-drag spins',
  };
  j.registerCapture(cap);
  const t = j.createThread({ semanticName: 'orbit spin' });

  j.attachToThread(t.stableId, { requestId: 'req_2163' });
  j.attachToThread(t.stableId, { captureId: 'cap_1' });

  const thread = j.thread(t.stableId)!;
  assert(thread.linkedRequests.includes('req_2163'), 'request linked');
  assert(thread.linkedBuilds.includes('1.0.0.2163'), 'request carried its build onto the thread');
  assert(thread.attachedCaptures.includes('cap_1'), 'capture attached');
  assert(note.threadIds.includes(t.stableId), 'note back-references the thread');
  assert(note.captureIds.includes('cap_1'), 'capture mirrored onto its build note');
  assert(j.capturesForThread(t.stableId)[0]!.name === 'orbit jitter', 'captures resolve to records');
});

test('attach is idempotent — re-attaching does not duplicate links', () => {
  const j = new BuildJournal();
  j.ingestRequest(req2163);
  const t = j.createThread({ semanticName: 'dup test' });
  j.attachToThread(t.stableId, { requestId: 'req_2163' });
  j.attachToThread(t.stableId, { requestId: 'req_2163' });
  assert(j.thread(t.stableId)!.linkedRequests.length === 1, 'request linked once');
  assert(j.noteByRequest('req_2163')!.threadIds.length === 1, 'back-ref recorded once');
});

// ── semantic search: ranked ──────────────────────────────────────────────────
test('findThreads ranks an exact name match above partial and token hits', () => {
  const j = new BuildJournal();
  const exact = j.createThread({ semanticName: 'jesus water walking', tags: ['physics'] });
  const partial = j.createThread({ semanticName: 'water walking collider gap', tags: ['water'] });
  const token = j.createThread({ semanticName: 'buoyancy', searchTokens: ['water', 'float'] });
  j.createThread({ semanticName: 'camera orbit' }); // must not match

  const hits = j.findThreads('jesus water walking');
  assert(hits.length >= 3, 'matched the three water threads, not the camera one');
  assert(hits[0]!.stableId === exact.stableId, 'exact name ranks first');
  assert(hits.some((h) => h.stableId === partial.stableId), 'substring/token thread included');
  assert(hits.some((h) => h.stableId === token.stableId), 'token-only thread included');
  assert(!hits.some((h) => h.semanticName === 'camera orbit'), 'non-matching thread excluded');
});

test('findThreads reattaches by a remembered old name via alias', () => {
  const j = new BuildJournal();
  const t = j.createThread({ semanticName: 'water walk' });
  j.renameThread(t.stableId, 'jesus water walking');
  const hits = j.findThreads('water walk'); // the OLD name
  assert(hits[0]!.stableId === t.stableId, 'old name still finds the thread via its alias');
});

// ── detach: inverse of attach, keeps back-refs in sync ───────────────────────
test('detachFromThread removes the request link and the note back-reference', () => {
  const j = new BuildJournal();
  const note = j.ingestRequest(req2163)!;
  const t = j.createThread({ semanticName: 'flaky water' });
  j.attachToThread(t.stableId, { requestId: 'req_2163' });
  j.detachFromThread(t.stableId, { requestId: 'req_2163' });
  assert(!j.thread(t.stableId)!.linkedRequests.includes('req_2163'), 'request unlinked from thread');
  assert(!note.threadIds.includes(t.stableId), 'note back-reference cleared');
});

test('detachFromThread is a no-op for an unknown thread or absent link', () => {
  const j = new BuildJournal();
  j.ingestRequest(req2163);
  const t = j.createThread({ semanticName: 'noop' });
  assert(j.detachFromThread('thread_9999', { requestId: 'req_2163' }) === undefined, 'unknown thread returns undefined');
  j.detachFromThread(t.stableId, { requestId: 'req_2163' }); // never attached — must not throw
  assert(j.thread(t.stableId)!.linkedRequests.length === 0, 'still empty after detaching an absent link');
});

// ── persistence: export/import round-trips threads + rebuilds back-refs ───────
test('exportThreadState + importThreadState survive a fresh journal and rewire notes', () => {
  const a = new BuildJournal();
  a.ingestRequest(req2163);
  const cap: LogCapture = {
    id: 'cap_p', name: 'persist me', channels: ['x'],
    timeRange: { start: 0, end: 1 }, buildId: '1.0.0.2163', mapContext: 'm', note: 'n',
  };
  a.registerCapture(cap);
  const t = a.renameThread(a.createThread({ semanticName: 'old name' }).stableId, 'persisted thread');
  a.attachToThread(t.stableId, { requestId: 'req_2163' });
  a.attachToThread(t.stableId, { captureId: 'cap_p' });
  const state = JSON.parse(JSON.stringify(a.exportThreadState())); // through disk shape

  const b = new BuildJournal();
  b.ingestRequest(req2163); // notes re-derive from the ledger first
  b.importThreadState(state);

  const restored = b.thread(t.stableId)!;
  assert(restored.semanticName === 'persisted thread', 'name restored');
  assert(restored.aliases.includes('old name'), 'rename alias survived the round-trip');
  assert(restored.linkedRequests.includes('req_2163'), 'request link restored');
  assert(restored.attachedCaptures.includes('cap_p'), 'capture link restored');
  assert(b.noteByRequest('req_2163')!.threadIds.includes(t.stableId), 'note back-ref rebuilt after import');
  assert(b.createThread({ semanticName: 'next' }).stableId !== t.stableId, 'seq advanced past restored ids');
});

test('describeThread sets a description that survives rename and the round-trip', () => {
  const a = new BuildJournal();
  const t = a.createThread({ semanticName: 'water bug' });
  assert(a.thread(t.stableId)!.description === '', 'description starts empty');
  a.describeThread(t.stableId, 'player clips through shallow water near the docks');
  a.renameThread(t.stableId, 'dock water clip'); // rename must not disturb the description
  assert(a.thread(t.stableId)!.description === 'player clips through shallow water near the docks', 'description held through rename');

  const b = new BuildJournal();
  b.importThreadState(JSON.parse(JSON.stringify(a.exportThreadState())));
  assert(b.thread(t.stableId)!.description === 'player clips through shallow water near the docks', 'description restored from disk shape');
});

// ── ratings + gospel: rank the pile, crown the needle ────────────────────────
test('rateAttempt scores an attempt on the 1..10 scale and clamps out of range', () => {
  const j = new BuildJournal();
  j.ingestRequest(req2163);
  const t = j.createThread({ semanticName: 'water walk' });
  j.attachToThread(t.stableId, { requestId: 'req_2163' });
  j.rateAttempt(t.stableId, 'req_2163', 9);
  assert(j.thread(t.stableId)!.ratings['req_2163'] === 9, 'rating stored');
  j.rateAttempt(t.stableId, 'req_2163', 99);
  assert(j.thread(t.stableId)!.ratings['req_2163'] === 10, 'clamped to 10');
  j.rateAttempt(t.stableId, 'req_2163', 0);
  assert(j.thread(t.stableId)!.ratings['req_2163'] === undefined, '0 clears the rating');
});

test('crownGospel pins one attempt as THE fix and floors its rating at 10', () => {
  const j = new BuildJournal();
  const t = j.createThread({ semanticName: 'jesus water walking' });
  j.attachToThread(t.stableId, { requestId: 'req_2163' });
  j.crownGospel(t.stableId, 'req_2163');
  assert(j.thread(t.stableId)!.gospel === 'req_2163', 'gospel crowned');
  assert(j.thread(t.stableId)!.ratings['req_2163'] === 10, 'crowning floors the rating at 10');
});

test('gospel is single-occupancy — crowning a new attempt replaces the old', () => {
  const j = new BuildJournal();
  const t = j.createThread({ semanticName: 'recurring bug' });
  j.crownGospel(t.stableId, 'req_2163');
  j.crownGospel(t.stableId, 'req_0007');
  assert(j.thread(t.stableId)!.gospel === 'req_0007', 'new gospel replaced the old');
  j.uncrownGospel(t.stableId);
  assert(j.thread(t.stableId)!.gospel === '', 'uncrown clears the gospel');
});

test('clearing a rating dethrones the gospel it belonged to', () => {
  const j = new BuildJournal();
  const t = j.createThread({ semanticName: 'flaky' });
  j.crownGospel(t.stableId, 'req_2163');
  j.rateAttempt(t.stableId, 'req_2163', 0);
  assert(j.thread(t.stableId)!.gospel === '', 'clearing the rating un-crowned the gospel');
});

test('ratings + gospel survive the export/import round-trip', () => {
  const a = new BuildJournal();
  const t = a.createThread({ semanticName: 'persist ratings' });
  a.attachToThread(t.stableId, { requestId: 'req_2163' });
  a.rateAttempt(t.stableId, 'req_2163', 6);
  a.crownGospel(t.stableId, 'req_2163');
  const b = new BuildJournal();
  b.importThreadState(JSON.parse(JSON.stringify(a.exportThreadState())));
  assert(b.thread(t.stableId)!.gospel === 'req_2163', 'gospel restored');
  assert(b.thread(t.stableId)!.ratings['req_2163'] === 10, 'rating restored');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) (globalThis as any).__exit?.(1);
