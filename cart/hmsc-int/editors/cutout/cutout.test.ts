// cutout.test.ts — P4 behavior tests for the cutout painter route's
// non-visual logic: extraction bookkeeping (mask → asset → mask, exact),
// the cutout-reopens-as-document law, the 'cutout' stream's library
// semantics (upsert / remove / unknown-kind tolerance / replay), and the
// session contract (a save is ONE commit: content event + labeled marker).
//
// Runs under tools/v8cli against real __fs_* bindings, in a scratch root
// under zig-out/ (never the live data/ content) — the sessions.test.ts idiom.

import { openStore } from '../../data';
import { createSessionLog } from '../sessions';
// the painter's HEADLESS core, imported directly (the paint.test.ts idiom —
// the door also exports the live React half, which a verify-bundled suite
// must not pull in)
import { PAINT_TUNING } from '../paint/tuning';
import { sampleToCells } from '../paint/strokes';
import {
  buildPaintDocument, inflatePaintDocument, makeLayer,
  parsePaintDocument, serializePaintDocument, type PaintDocument,
} from '../paint/layers';
import { cutoutStream, libraryCutouts, libraryDocuments, type CutoutStreamState, type CutoutEvent } from './stream';
import {
  countSelected, cutoutToDocument, extractCutout, inflateCutoutMask,
  mintCutoutId, mintDocumentId, previewCells, stockLookDefaults, uniqueAssetName,
} from './extraction';
import { buildDraft, parseDraft, serializeDraft } from './draft';
import { assert, assertEqual, finish, test } from '../../game/_testkit';

declare const globalThis: any;

const ROOT = 'zig-out/game/test-cutout';

function wipeScratch(): void {
  for (const path of [
    `${ROOT}/streams/cutout.jsonl`, `${ROOT}/streams/sessions.jsonl`,
    `${ROOT}/snapshots/cutout.snapshot.json`, `${ROOT}/snapshots/sessions.snapshot.json`,
  ]) globalThis.__fs_remove?.(path);
}

/** A deterministic test mask: a w×h field with a filled rectangle. */
function rectMask(w: number, h: number, x0: number, y0: number, x1: number, y1: number): Uint8Array {
  const mask = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * w + x] = 1;
  return mask;
}

/** A minimal real document (the shape a save commits). */
function sampleDocument(name: string, w: number, h: number): PaintDocument {
  const defaults = stockLookDefaults();
  const layer = makeLayer(defaults, 0, name);
  return buildPaintDocument({
    dims: { w, h },
    layers: [{ ...layer, base: rectMask(w, h, 1, 1, 3, 3), brush: null }],
    activeLayer: 0,
    tool: 'brush',
    mode: 'erase',
    brushPx: PAINT_TUNING.brushDefaultPx,
    defaults,
    customSurfaces: [],
  });
}

test('extraction refuses an empty selection — a mistake to surface, not an asset', () => {
  const empty = extractCutout({ name: 'nothing', dims: { w: 8, h: 8 }, mask: new Uint8Array(64), srcPath: null, docId: null });
  assertEqual(empty, null, 'an all-zero mask extracts to null');
  const short = extractCutout({ name: 'short', dims: { w: 8, h: 8 }, mask: new Uint8Array(10), srcPath: null, docId: null });
  assertEqual(short, null, 'a mask smaller than dims extracts to null');
});

test('extraction round-trip: the asset carries the exact selection', () => {
  const w = 32, h = 24;
  const mask = rectMask(w, h, 4, 3, 20, 17);
  const asset = extractCutout({ name: 'window', dims: { w, h }, mask, srcPath: '/tmp/x.png', docId: 'cd-test' });
  assert(!!asset, 'a non-empty selection extracts');
  assertEqual(asset!.pixels, countSelected(mask), 'pixel bookkeeping counts the selection');
  assertEqual(asset!.pixels, 16 * 14, 'and the count is the rectangle area');
  const back = inflateCutoutMask(asset!);
  assertEqual(back.length, mask.length, 'the inflated mask is source resolution');
  for (let i = 0; i < mask.length; i++) {
    if ((back[i] ? 1 : 0) !== mask[i]) throw new Error(`mask round-trip differs at ${i}`);
  }
  // the preview is the painter's own downsample, sorted and bounded
  const expect = sampleToCells(mask, w, h, PAINT_TUNING.overlayRes);
  const cells = previewCells(asset!);
  assertEqual(cells.size, expect.size, 'preview matches sampleToCells');
  for (const c of expect) assert(cells.has(c), 'preview carries every sampled cell');
  const sorted = asset!.preview.every((v, i) => i === 0 || asset!.preview[i - 1] < v);
  assert(sorted, 'preview cells are stored sorted (stable JSON, dedup-friendly)');
});

test('a cutout reopens as a working document (the composability law)', () => {
  const w = 16, h = 16;
  const mask = rectMask(w, h, 2, 2, 9, 12);
  const asset = extractCutout({ name: 'door', dims: { w, h }, mask, srcPath: null, docId: null })!;
  const doc = cutoutToDocument(asset);
  // the document survives its own serialize/parse gate
  const parsed = parsePaintDocument(serializePaintDocument(doc));
  assert(!!parsed, 'the reopened document parses under the painter version gate');
  assertEqual(parsed!.dims.w, w, 'dims carry');
  assertEqual(parsed!.layers.length, 1, 'one layer holds the cutout');
  assertEqual(parsed!.layers[0].name, 'door', 'the layer is named after the asset');
  const inflated = inflatePaintDocument(parsed!);
  const base = inflated[0].base!;
  for (let i = 0; i < mask.length; i++) {
    if ((base[i] ? 1 : 0) !== mask[i]) throw new Error(`reopened base differs from the cutout at ${i}`);
  }
  assertEqual(inflated[0].brush, null, 'no override channel — the mask is the smart base');
});

test('library stream: saved is an upsert, removed deletes, unknown kinds pass through', () => {
  let state: CutoutStreamState = cutoutStream.initial();
  const apply = (e: CutoutEvent) => { state = cutoutStream.apply(state, e); };

  const doc = sampleDocument('skin a', 8, 8);
  apply({ kind: 'saved', id: 'cd-1', name: 'skin a', srcPath: null, doc });
  apply({ kind: 'saved', id: 'cd-2', name: 'skin b', srcPath: '/tmp/b.png', doc });
  assertEqual(libraryDocuments(state).map((d) => d.id).join('|'), 'cd-1|cd-2', 'first-saved order');

  const doc2 = sampleDocument('skin a v2', 8, 8);
  apply({ kind: 'saved', id: 'cd-1', name: 'skin a v2', srcPath: null, doc: doc2 });
  assertEqual(libraryDocuments(state).length, 2, 're-save upserts, never duplicates');
  assertEqual(state.documents['cd-1'].name, 'skin a v2', 'and replaces the content');

  const mask = rectMask(8, 8, 0, 0, 4, 4);
  const asset = extractCutout({ name: 'corner', dims: { w: 8, h: 8 }, mask, srcPath: null, docId: 'cd-1' })!;
  apply({ kind: 'extracted', id: asset.id, asset });
  assertEqual(libraryCutouts(state).length, 1, 'extraction lands in the cutout library');
  assertEqual(libraryCutouts(state)[0].docId, 'cd-1', 'and remembers its source document');

  apply({ kind: 'removed', id: 'cd-1', target: 'document' });
  assertEqual(libraryDocuments(state).map((d) => d.id).join('|'), 'cd-2', 'document removal');
  apply({ kind: 'removed', id: asset.id, target: 'cutout' });
  assertEqual(libraryCutouts(state).length, 0, 'cutout removal');
  apply({ kind: 'removed', id: 'ghost', target: 'cutout' });
  assertEqual(libraryCutouts(state).length, 0, 'removing the unknown is a no-op, never a crash');

  const before = JSON.stringify(state);
  apply({ kind: 'sqi-imported', anything: true } as any);
  assertEqual(JSON.stringify(state), before, 'unknown future kinds pass through untouched (V20)');
});

test('the session contract: a save is ONE commit — content event + labeled marker', () => {
  wipeScratch();
  const store = openStore(ROOT);
  const log = createSessionLog(store);
  const channel = store.defineStream(cutoutStream);
  const ses = log.open('/cutout', channel, 'ses-cut');

  ses.note('brush stroke · erase · 32px · Layer 1'); // the painter's per-interaction note
  const doc = sampleDocument('hoodie', 16, 16);
  ses.commit({ kind: 'saved', id: 'cd-x', name: 'hoodie', srcPath: null, doc }, 'save · hoodie · 16×16 · 1 layer');

  assertEqual(channel.length(), 1, 'only the save lands a content event');
  assertEqual(libraryDocuments(channel.state())[0].name, 'hoodie', 'the channel materializes the library');
  const record = log.state().sessions['ses-cut'];
  assertEqual(record.commits.length, 2, 'note + save are both interactions on the history');
  assertEqual(record.commits[0].at, null, 'the stroke is a marker-only note');
  assertEqual(record.commits[1].at, record.commits[1].seq - 1, 'the save marker records its content event right below it');
  assert(record.commits[1].label.startsWith('save · hoodie'), 'the label is the action, not the mechanism');

  const snap = store.loadSnapshot<CutoutStreamState>('cutout');
  assert(!!snap, 'the commit materialized the cutout snapshot (what consumers load)');
  assertEqual(libraryDocuments(snap!.state)[0].id, 'cd-x', 'with the saved document in it');
});

test('replay = identical library: a fresh open folds the same history', () => {
  const reopened = openStore(ROOT);
  const channel = reopened.defineStream(cutoutStream);
  assertEqual(libraryDocuments(channel.state()).length, 1, 'the saved document survives reopen');
  assertEqual(libraryDocuments(channel.state())[0].name, 'hoodie', 'content identical across sessions');
});

test('names and ids: collision-free minting', () => {
  assert(mintDocumentId().startsWith('cd-'), 'document ids are namespaced');
  assert(mintCutoutId().startsWith('cut-'), 'cutout ids are namespaced');
  assert(mintCutoutId() !== mintCutoutId(), 'mints differ');
  assertEqual(uniqueAssetName('door', []), 'door', 'free name passes through');
  assertEqual(uniqueAssetName('door', ['door']), 'door 2', 'collision appends a counter');
  assertEqual(uniqueAssetName('door', ['door', 'door 2']), 'door 3', 'and keeps counting');
  assertEqual(uniqueAssetName('   ', []), 'cutout', 'blank names fall back');
});

test('the working draft round-trips and gates strictly (the autosave lifeline)', () => {
  const doc = sampleDocument('wip skin', 12, 10);
  const draft = buildDraft({ docId: 'cd-w', name: 'wip skin', srcPath: '/tmp/skin.png', doc });
  const back = parseDraft(serializeDraft(draft));
  assert(!!back, 'a built draft parses');
  assertEqual(back!.docId, 'cd-w', 'the library identity carries — a restored draft re-saves into the same entry');
  assertEqual(back!.srcPath, '/tmp/skin.png', 'the source path carries');
  assertEqual(back!.doc.dims.w, 12, 'the embedded document carries');
  assertEqual(JSON.stringify(inflatePaintDocument(back!.doc)[0].clicks), JSON.stringify([]), 'layers inflate from the draft');

  const blank = parseDraft(serializeDraft(buildDraft({ docId: 'cd-b', name: 'blank', srcPath: null, doc })));
  assertEqual(blank!.srcPath, null, 'blank-canvas drafts keep srcPath null');

  assertEqual(parseDraft('not json'), null, 'garbage → null (boot blank, never half-restore)');
  assertEqual(parseDraft(JSON.stringify({ kind: 'cutout-draft', version: 99, docId: 'x', name: '', srcPath: null, doc })), null, 'future versions are rejected by the gate');
  assertEqual(parseDraft(JSON.stringify({ kind: 'cutout-draft', version: 1, docId: 'x', name: '', srcPath: null, doc: { kind: 'wrong' } })), null, 'a draft with a non-paint document is rejected');
});

finish('editors/cutout');
