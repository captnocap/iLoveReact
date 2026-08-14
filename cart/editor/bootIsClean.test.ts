// cart/editor/bootIsClean.test.ts — "BOOT IS CLEAN" (req_4435).
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/bootIsClean.test.ts --bundle \
//     --outfile=/tmp/editor-boot-is-clean.test.js --format=iife --platform=neutral --target=es2022 \
//     --alias:@reactjit/runtime=$ROOT/runtime --alias:@reactjit=$ROOT/runtime
//   tools/v8cli /tmp/editor-boot-is-clean.test.js
//
// The invariant this file exists to hold: A COLD BOOT SHOWS NOTHING THE USER
// DID NOT CHOOSE. Every assertion below corresponds to a thing the boot frame
// actually claimed before this pass — a "Concrete Floor" nobody armed, an
// "Abalone Shell" nobody clicked, a "Selected material" tile that was never a
// real object — so a regression here is that exact frame coming back.
import { initialState } from './data/initialState';
import { assetById, assetByIdOrNull } from './data/catalog';
import { selectedObject, panelModeFor } from './data/content';
import { selectionPosition } from './data/readouts';
import { mapAuthoringSlicesFor } from './data/mapDocumentState';
import { leftPanelsFor, rightPanelsFor } from './data/panelSystem';
import { HOME_DOCUMENT, HOME_DOCUMENT_ID, WORLD_DOCUMENT, worldDocument } from './data/documents';
import { parseSessionText, sessionDocumentsFrom, SESSION_MAX_DOCUMENTS } from './data/sessionStore';
import { oneLine, oneLineColumn, ONE_LINE_PROPS, ONE_LINE_STYLE } from './panelText';
import {
  JOKES,
  QUOTES,
  celebrationFor,
  pick,
  relativeAge,
  resumeSummary,
} from './home/homeContent';
import { confettiData, particlesFor, PARTICLE_LIMIT, CONFETTI_SHADER } from './home/confetti';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

// ── 1. NO PHANTOM FOCUS ────────────────────────────────────────────────────

test('boot arms no build piece', () => {
  assert(initialState().armedPieceId === null, 'initialState re-seeded an armed piece — the focus panel will describe it at boot');
});

test('boot selects no material', () => {
  assert(initialState().activeAssetId === null, 'initialState re-seeded activeAssetId — the asset drawer will focus a catalog default');
});

test('boot selects no world object and seeds no placeholder objects', () => {
  const state = initialState();
  assert(state.selectedObjectId === null, 'initialState re-seeded selectedObjectId');
  assert(state.objects.length === 0, 'initialState seeded placeholder world objects');
});

test('opening a map arms nothing', () => {
  const slices = mapAuthoringSlicesFor(
    initialState(),
    'somemap',
    { pieces: [], worldFlora: [], prefabs: [], facades: [], views: [], objects: [], zones: [], seq: 1 } as any,
    [],
  );
  assert(slices.armedPieceId === null, 'opening a map re-armed a default piece');
});

test('selectedObject returns null rather than inventing a subject', () => {
  const state = initialState();
  assert(selectedObject(state) === null, 'selectedObject fell back to a synthetic placeholder object');
  assert(selectionPosition(state) === null, 'selectionPosition reported coordinates for a selection that does not exist');
});

test('panelModeFor survives a null selection', () => {
  const state = initialState();
  assert(panelModeFor(state, null) === state.activeTab, 'panelModeFor could not describe an empty selection');
});

test('assetByIdOrNull refuses to substitute the catalog default', () => {
  assert(assetByIdOrNull(null) === null, 'a null selection resolved to an asset');
  assert(assetByIdOrNull('no-such-asset-id-exists') === null, 'an unknown id resolved to an asset');
  // assetById's forgiving fallback still exists for display paths; the point is
  // that it is no longer what answers "did the user pick something".
  assert(assetById('no-such-asset-id-exists') !== null, 'assetById lost its display fallback');
});

// ── 2. SESSION RESTORE ─────────────────────────────────────────────────────

test('cold boot opens Home and Home borrows no rails', () => {
  assert(HOME_DOCUMENT.kind === 'home' && HOME_DOCUMENT.id === HOME_DOCUMENT_ID, 'the Home document lost its identity');
  assert(leftPanelsFor('home').length === 0, 'Home claimed a left rail it does not render');
  assert(rightPanelsFor('home').length === 0, 'Home claimed a focus rail it does not render');
});

test('the world tab carries its real map name, never a fictional file', () => {
  assert(WORLD_DOCUMENT.subtitle === undefined, 'the world document re-acquired a hardcoded subtitle');
  assert(worldDocument('coastal-3').subtitle === 'coastal-3', 'the world tab did not take the live map name');
});

test('a session round-trips the working state it promises', () => {
  const written = JSON.stringify({
    version: 1,
    savedMs: 1_700_000_000_000,
    launch: 42,
    mapStem: 'coastal-3',
    mapName: 'Coastal 3',
    documents: [{ id: 'world:main', kind: 'world' }, { id: 'model:x', kind: 'model', sourceId: 'x' }],
    activeDocumentId: 'model:x',
    rightPane: 'paint',
    rightPanelCollapsed: false,
    activeDomain: 'assets',
    leftPanelCollapsed: false,
    libraryExpanded: true,
    contentFolder: 'materials-core',
    activeCommandId: 'select-tool',
    activeAssetId: 'brick-red',
    selectedPieceId: 'piece-7',
    floorIndex: 2,
    camera: { centerX: 12, centerZ: -4, yaw: 45, pitch: 30, zoom: 1.5, floor: 2 },
  });
  const session = parseSessionText(written);
  assert(session.mapName === 'Coastal 3', 'the map name did not survive');
  assert(session.launch === 42, 'the launch count did not survive');
  assert(session.documents.length === 2, 'the open tabs did not survive');
  assert(session.activeDocumentId === 'model:x', 'the active tab did not survive');
  assert(session.floorIndex === 2 && session.camera?.yaw === 45, 'the floor/camera stance did not survive');
  assert(session.activeAssetId === 'brick-red', 'the selected material did not survive');
});

test('a session can faithfully record "nothing selected"', () => {
  const session = parseSessionText(JSON.stringify({
    version: 1, savedMs: 1, launch: 1, mapStem: 'm', mapName: 'M',
    documents: [{ id: 'world:main', kind: 'world' }], activeDocumentId: 'world:main',
    activeAssetId: null, selectedPieceId: null, floorIndex: 0, camera: null,
  }));
  assert(session.activeAssetId === null && session.selectedPieceId === null, 'an empty selection was restored as a selection');
  assert(session.camera === null, 'a missing camera was invented');
});

test('a malformed session is rejected rather than half-restored', () => {
  let threw = false;
  try { parseSessionText(JSON.stringify({ version: 1, savedMs: 1 })); } catch { threw = true; }
  assert(threw, 'a session with no map stem was accepted');
  let versionThrew = false;
  try { parseSessionText(JSON.stringify({ version: 99, mapStem: 'm' })); } catch { versionThrew = true; }
  assert(versionThrew, 'a future session version was accepted');
});

test('an active tab that was not reopened cannot leave the stage blank', () => {
  const session = parseSessionText(JSON.stringify({
    version: 1, savedMs: 1, launch: 1, mapStem: 'm', mapName: 'M',
    documents: [{ id: 'world:main', kind: 'world' }],
    activeDocumentId: 'model:deleted',
  }));
  assert(session.activeDocumentId === 'world:main', 'a dangling active id was kept');
});

test('Home is never recorded as a resumable tab', () => {
  const recorded = sessionDocumentsFrom([HOME_DOCUMENT, WORLD_DOCUMENT]);
  assert(recorded.length === 1 && recorded[0]!.id === WORLD_DOCUMENT.id, 'resuming would reopen the resume board');
});

test('the tab record is bounded', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ id: `model:${i}`, kind: 'model' as const, title: `M${i}`, sourceId: `${i}` }));
  assert(sessionDocumentsFrom(many).length === SESSION_MAX_DOCUMENTS, 'the session record grew without bound');
});

test('the resume summary claims only what the record carries', () => {
  assert(resumeSummary(3, 0, false) === '3 tabs · ground floor', 'the summary invented a camera it does not have');
  assert(resumeSummary(1, 2, true) === '1 tab · floor 2 · camera', 'the summary dropped what it does have');
});

// ── 3. OVERFLOW POLICY ─────────────────────────────────────────────────────

test('every single-line panel string carries BOTH halves of the policy', () => {
  const def = oneLine(10, 'theme:text', { fontFamily: 'monospace' });
  assert(def.noWrap === ONE_LINE_PROPS.noWrap && def.numberOfLines === ONE_LINE_PROPS.numberOfLines,
    'the elision props went missing — paint would draw the natural width past the box');
  assert((def.style as any).flexShrink === ONE_LINE_STYLE.flexShrink && (def.style as any).minWidth === ONE_LINE_STYLE.minWidth,
    'min-width 0 went missing — flex cannot shrink a nowrap string and it bleeds out of the panel');
  assert((def.style as any).fontFamily === 'monospace', 'caller style was dropped');
});

test('caller style may override the policy only deliberately', () => {
  const pinned = oneLine(10, 'theme:text', { minWidth: 40 });
  assert((pinned.style as any).minWidth === 40, 'an explicit minWidth was ignored');
});

test('a label column holds its column instead of shrinking', () => {
  const column = oneLineColumn(10, 'theme:textDim', 82, { fontFamily: 'monospace' });
  assert((column.style as any).flexShrink === 0, 'the label column would shrink and break panel alignment');
  assert((column.style as any).minWidth === 82, 'the label column lost its width');
  assert(column.noWrap === true, 'the label column lost its own elision');
});

// ── 4/5. THE HOMEPAGE ──────────────────────────────────────────────────────

test('the rotating lines are deterministic and in range', () => {
  assert(pick(JOKES, 0) === JOKES[0], 'the first pick drifted');
  assert(pick(JOKES, JOKES.length) === JOKES[0], 'the rotation does not wrap');
  assert(pick(QUOTES, -1) === QUOTES[QUOTES.length - 1], 'a negative index escaped the list');
  assert(JOKES.length > 12 && QUOTES.length > 6, 'the lines got thin enough to repeat noticeably');
  assert(JOKES.every((line) => !line.includes('`')), 'a joke carries a backtick and would break a template literal');
});

test('milestones celebrate and ordinary launches mostly do not', () => {
  assert(celebrationFor(1, 1)?.label.includes('#1') === true, 'the very first launch went unmarked');
  assert(celebrationFor(100, 1) !== null, 'launch 100 went unmarked');
  assert(celebrationFor(700, 1) !== null, 'a recurring hundred went unmarked');
  assert(celebrationFor(37, 1) === null, 'an ordinary launch celebrated on a losing roll');
  assert(celebrationFor(37, 0) !== null, 'the surprise burst can never fire');
  assert(celebrationFor(0, 0) === null, 'a zeroth launch celebrated');
});

test('celebration intensity stays inside the particle budget', () => {
  for (const launch of [1, 10, 25, 50, 100, 250, 500, 1000]) {
    const party = celebrationFor(launch, 1)!;
    assert(party.intensity > 0 && party.intensity <= 1, `launch ${launch} produced an out-of-range intensity`);
    const count = particlesFor(party.intensity);
    assert(count > 0 && count <= PARTICLE_LIMIT, `launch ${launch} asked for ${count} particles`);
  }
});

test('the confetti uniform is clamped on every field', () => {
  const data = confettiData(9, 9999, 0.5);
  assert(data[0] === 1, 'progress escaped 0..1');
  assert(data[1] === PARTICLE_LIMIT, 'the particle count escaped the shader loop bound');
  assert(confettiData(-3, -5, 0)[0] === 0, 'progress escaped below 0');
});

test('the confetti quad takes its aspect from the host, never a guess', () => {
  assert(CONFETTI_SHADER.includes('U.size_w') && CONFETTI_SHADER.includes('U.size_h'),
    'a hardcoded aspect would stretch every particle at any other window shape');
});

test('the confetti shader obeys the house WGSL rules', () => {
  assert(!CONFETTI_SHADER.includes('`'), 'a backtick in the shader would end its template literal');
  assert(!/[^\w)\]]\s\+\d/.test(CONFETTI_SHADER.replace(/\+ /g, '')), 'a unary plus would fail shader-module creation');
  assert(CONFETTI_SHADER.includes('fs_main'), 'the shader lost its fragment entry point');
});

test('relative ages read like a person wrote them', () => {
  const now = 1_700_000_000_000;
  assert(relativeAge(0, now) === 'never', 'an unwritten session claimed an age');
  assert(relativeAge(now - 5_000, now) === 'just now', 'seconds ago read wrong');
  assert(relativeAge(now - 120_000, now) === '2 minutes ago', 'minutes read wrong');
  assert(relativeAge(now - 7_200_000, now) === '2 hours ago', 'hours read wrong');
  assert(relativeAge(now - 172_800_000, now) === '2 days ago', 'days read wrong');
});

log(`\nboot is clean: ${passed} passed, ${failed} failed`);
if (failed > 0) (globalThis as any).__exit?.(1);
