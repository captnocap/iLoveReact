// Run:
//   tools/esbuild cart/editor/agent/seatMemory.test.ts --bundle --outfile=/tmp/editor-seat-memory.test.js --format=iife --platform=neutral --target=es2022
//   tools/v8cli /tmp/editor-seat-memory.test.js
//
// The two memories, tested apart because they exist apart: disposable per-model notes
// (seatNotes) and the curated, measured class corpus (seatClassSpec + seatTelemetry).
import {
  NOTE_BOOK_LIMIT,
  NOTE_TEXT_LIMIT,
  appendNote,
  dropNote,
  emptyNoteBook,
  parseNoteKind,
  summarizeNotes,
  type SeatNoteBook,
} from './seatNotes';
import {
  ARTICULATION_QUORUM,
  CLASS_TOLERANCE,
  boxProfile,
  classifyByCorpus,
  deriveClassSpec,
  gradeArticulation,
  gradeDimensions,
  gradeNaming,
  gradeTriangleBudget,
  percentile,
  quadRatioOf,
  sidePrefixesOf,
  type ClassSpec,
  type ExemplarFacts,
} from './seatClassSpec';
import { parseTelemetry, summarizeTelemetry, type SeatTelemetryRow } from './seatTelemetry';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

const write = (book: SeatNoteBook, text: string, kind: 'decision' | 'observation' | 'todo', generation: number): SeatNoteBook => {
  const appended = appendNote(book, { text, kind, generation, at: '2026-08-08T00:00:00Z' });
  if ('reason' in appended) throw new Error(appended.reason);
  return appended.book;
};

// ── notes ─────────────────────────────────────────────────────────────────────

test('a decision stays durable across edits; an observation goes suspect', () => {
  let book = emptyNoteBook('prop:bench');
  book = write(book, 'user wants the hood asymmetric, do not mirror it', 'decision', 4);
  book = write(book, 'left leg still floats', 'observation', 4);
  const summary = summarizeNotes(book, 9);
  const decision = summary.notes.find((note) => note.kind === 'decision')!;
  const observation = summary.notes.find((note) => note.kind === 'observation')!;
  assert(decision.stale === false, 'intent expired because geometry moved');
  assert(observation.stale === true, 'an observation from 5 generations ago read as current');
  assert(observation.generationsAgo === 5, `generationsAgo was ${observation.generationsAgo}`);
  assert(summary.decisions === 1 && summary.suspect === 1, `summary was ${summary.decisions}/${summary.suspect}`);
});

test('nothing is suspect while the mesh has not moved', () => {
  let book = emptyNoteBook('prop:bench');
  book = write(book, 'todo: bridge the rear seam', 'todo', 7);
  assert(summarizeNotes(book, 7).suspect === 0, 'a note went stale at its own generation');
});

test('a full pad drops observations before decisions', () => {
  let book = emptyNoteBook('prop:bench');
  book = write(book, 'the one thing that matters', 'decision', 1);
  for (let at = 0; at < NOTE_BOOK_LIMIT + 5; at += 1) book = write(book, `observation ${at}`, 'observation', 1);
  assert(book.notes.length === NOTE_BOOK_LIMIT, `pad held ${book.notes.length}`);
  assert(book.notes.some((note) => note.kind === 'decision'), 'the decision was evicted before the observations');
});

test('a note refuses to become a report', () => {
  const book = emptyNoteBook('prop:bench');
  const empty = appendNote(book, { text: '   ', kind: 'observation', generation: 1, at: 'now' });
  assert('reason' in empty, 'an empty note was accepted');
  const huge = appendNote(book, { text: 'x'.repeat(NOTE_TEXT_LIMIT + 1), kind: 'observation', generation: 1, at: 'now' });
  assert('reason' in huge && /handoff line/.test(huge.reason), 'an oversized note was accepted');
});

test('notes are droppable and kinds are validated', () => {
  let book = emptyNoteBook('prop:bench');
  book = write(book, 'first', 'observation', 1);
  const dropped = dropNote(book, book.notes[0]!.id);
  assert(!('reason' in dropped) && dropped.notes.length === 0, 'a note would not drop');
  assert('reason' in dropNote(book, 999), 'dropping a missing note succeeded');
  assert(parseNoteKind('decision') === 'decision' && parseNoteKind('rumour') === null, 'kind validation is wrong');
});

// ── class specs ───────────────────────────────────────────────────────────────

const car = (model: string, over: Partial<ExemplarFacts> = {}): ExemplarFacts => ({
  model, triangles: 3400, authoredFaces: 1800,
  bbox: [-0.9, 0, -2.1, 0.9, 1.45, 2.1],
  regionNames: ['ds_front_door', 'ps_front_door', 'roof', 'hood', 'ds_rocker', 'ps_rocker'],
  partNames: ['car_body', 'ds_front_door', 'ps_front_door', 'front_hood_lid', 'trunk_lid'],
  ...over,
});

test('a class spec is derived from measurements, and says how thin its evidence is', () => {
  const one = deriveClassSpec('car', [car('a')]);
  assert(!('reason' in one), 'a single exemplar produced no spec');
  if ('reason' in one) return;
  assert(one.derivedFrom === 1 && !!one.caveat, 'a one-exemplar spec did not carry its caveat');
  const three = deriveClassSpec('car', [car('a'), car('b', { triangles: 5200 }), car('c', { triangles: 2900 })]);
  assert(!('reason' in three) && three.caveat === null, 'a three-exemplar spec still claimed to be thin');
});

test('the part list IS the articulation spec, at quorum', () => {
  const spec = deriveClassSpec('car', [
    car('a'),
    car('b'),
    car('c', { partNames: ['car_body', 'ds_front_door', 'ps_front_door', 'front_hood_lid', 'trunk_lid', 'spoiler'] }),
  ]);
  assert(!('reason' in spec), 'no spec derived');
  if ('reason' in spec) return;
  assert(spec.parts.articulation.includes('trunk_lid'), 'a part in every exemplar missed the articulation set');
  // One exemplar's stray part must not become law for the class.
  assert(!spec.parts.articulation.includes('spoiler'), 'a 1-of-3 part became class articulation');
  assert(spec.parts.quorum === Math.ceil(3 * ARTICULATION_QUORUM), `quorum was ${spec.parts.quorum}`);
});

test('a model missing a class articulation part is told which junctions stay separate', () => {
  const spec = deriveClassSpec('car', [car('a'), car('b')]) as ClassSpec;
  const verdict = gradeArticulation(spec, ['car_body', 'ds_front_door'])!;
  assert(verdict.pass === false, 'a car with no trunk lid passed articulation');
  assert(/trunk_lid/.test(verdict.detail), 'the refusal did not name the missing part');
  assert(/open or break/.test(verdict.detail), 'the refusal did not say WHY they stay separate');
});

test('class dimensions catch the oversized trap and pass a real car', () => {
  const spec = deriveClassSpec('car', [car('a'), car('b')]) as ClassSpec;
  assert(gradeDimensions(spec, [-0.9, 0, -2.1, 0.9, 1.45, 2.1])!.pass === true, 'an exemplar-sized car failed its own class');
  const oversized = gradeDimensions(spec, [-3.6, 0, -8.4, 3.6, 5.8, 8.4])!;
  assert(oversized.pass === false, 'a 4x-oversized car passed the class range');
  assert(/SCALE before adding detail/.test(oversized.detail), 'the refusal did not say to fix scale first');
});

test('the triangle budget is graded against p90 plus tolerance', () => {
  const spec = deriveClassSpec('car', [car('a', { triangles: 3000 }), car('b', { triangles: 3400 }), car('c', { triangles: 5200 })]) as ClassSpec;
  assert(gradeTriangleBudget(spec, 3400).pass === true, 'a median-sized car blew its own budget');
  assert(gradeTriangleBudget(spec, Math.ceil(spec.triangles.p90 * (1 + CLASS_TOLERANCE)) + 1).pass === false, 'an over-budget mesh passed');
});

test('naming grades the side convention the class actually uses', () => {
  const spec = deriveClassSpec('car', [car('a'), car('b')]) as ClassSpec;
  assert(spec.naming.sidePrefixes.join(',') === 'ds_,ps_', `prefixes were ${spec.naming.sidePrefixes.join(',')}`);
  const wrong = gradeNaming(spec, ['left_front_door', 'right_front_door', 'roof', 'hood', 'a_x', 'b_y']);
  assert(wrong.pass === false, 'a model ignoring the class convention passed');
  assert(/ds_|ps_/.test(wrong.detail), 'the refusal did not name the convention');
});

test('quad ratio reads soup and quads apart', () => {
  assert(quadRatioOf(3600, 1800) === 1, 'a pure quad mesh did not read as 1');
  assert(quadRatioOf(3600, 3600) === 0, 'loose triangles did not read as 0');
  assert(quadRatioOf(3600, null) === null, 'an unknown face count invented a ratio');
});

test('box profile is orientation-independent', () => {
  const alongZ = boxProfile([-0.9, 0, -2.1, 0.9, 1.45, 2.1]);
  const alongX = boxProfile([-2.1, 0, -0.9, 2.1, 1.45, 0.9]);
  assert(Math.abs(alongZ.length - alongX.length) < 1e-9, 'the same car measured differently by facing');
  assert(alongZ.length > alongZ.width, 'length and width came out swapped');
});

test('percentile and prefix detection hold their edges', () => {
  assert(percentile([], 0.5) === null, 'an empty set produced a percentile');
  assert(percentile([1, 2, 3], 0.5) === 2, 'median is wrong');
  assert(sidePrefixesOf(['a_one']).length === 0, 'a single use became a convention');
  assert(sidePrefixesOf(['ds_a', 'ds_b']).join(',') === 'ds_', 'a repeated prefix was missed');
});

test('a task is matched to a class by the corpus, longest signal first', () => {
  const corpus = { version: 1 as const, classes: {
    car: { signals: ['car', 'sedan'], exemplars: [] },
    prop: { signals: ['prop'], exemplars: [] },
  } };
  assert(classifyByCorpus('build a compact sedan', corpus)?.classId === 'car', 'a sedan did not match the car class');
  assert(classifyByCorpus('build a lamp', corpus) === null, 'an unmatched task claimed a class');
});

test('a class with no approved exemplars derives nothing rather than inventing bounds', () => {
  const spec = deriveClassSpec('car', []);
  assert('reason' in spec && /approve at least one/.test(spec.reason), 'an empty class produced a spec');
});

// ── telemetry ─────────────────────────────────────────────────────────────────

const row = (over: Partial<SeatTelemetryRow>): SeatTelemetryRow => ({
  at: '2026-08-08T00:00:00Z', session: 's1', model: 'prop:bench', plan: 'blockout',
  classId: null, phase: 'topology', event: 'refused', ...over,
});

test('the difficulty stat separates four attempts in one session from one in four', () => {
  const rows = [
    row({ session: 's1', checks: ['junctions-resolved'] }),
    row({ session: 's1', checks: ['junctions-resolved'] }),
    row({ session: 's1', checks: ['junctions-resolved'] }),
    row({ session: 's1', checks: ['junctions-resolved'] }),
    row({ session: 's2', checks: ['unreachable-budget'] }),
    row({ session: 's3', checks: ['unreachable-budget'] }),
  ];
  const summary = summarizeTelemetry(rows);
  const hardest = summary.checks[0]!;
  assert(hardest.id === 'junctions-resolved', `hardest was ${hardest.id}`);
  assert(hardest.attemptsPerSession === 4, `attemptsPerSession was ${hardest.attemptsPerSession}`);
  const spread = summary.checks.find((check) => check.id === 'unreachable-budget')!;
  assert(spread.sessions === 2 && spread.attemptsPerSession === 1, 'a widely-hit-once check was ranked as hard');
});

test('rejection reasons are kept — they are the rows that become checks', () => {
  const summary = summarizeTelemetry([
    row({ event: 'outcome', outcome: { verdict: 'approved', triangles: 3400, unnamed: 0, unreachableFaces: 4 } }),
    row({ event: 'outcome', outcome: { verdict: 'rejected', reason: 'doors welded shut', triangles: 3400, unnamed: 0, unreachableFaces: 4 } }),
  ]);
  assert(summary.outcomes.approved === 1 && summary.outcomes.rejected === 1, 'outcomes miscounted');
  assert(summary.outcomes.reasons[0] === 'doors welded shut', 'a rejection reason was dropped');
});

test('a torn append costs one row, never the store', () => {
  const rows = parseTelemetry(`${JSON.stringify(row({}))}\n{"broken":\n${JSON.stringify(row({ session: 's2' }))}`);
  assert(rows.length === 2, `expected 2 readable rows, got ${rows.length}`);
});

log(`seatMemory: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`);
