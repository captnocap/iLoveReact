// bench.test.ts — P4 behavior tests for the AGNOSTIC paint bench
// (AGNOSTICPAINT-0606): target-open round-trip PER FAMILY (blank / image /
// material / figure-part / vehicle-part / document / cutout) and MATERIALIZE
// routing per consumer (figure → characters channel + char adopt; vehicle →
// vehicles channel; cutout asset → the material door; else → the library).
// Headless: recorders stand in for every wire; the fake library channel
// FOLDS commits through cutoutStream.apply, so save→reopen is a real
// round-trip.

import { assert, assertEqual, finish, test } from '../../../game/_testkit';
import { createPaintBenchStore, type PaintBenchDeps, type PainterApi } from './store';
import { resolveTarget, encodeTargetRow, decodeTargetRow, type PaintTarget } from './targets';
import { cutoutStream, libraryCutouts, libraryDocuments, type CutoutStreamState } from '../../cutout/stream';
import { emptyDraftBook, upsertDraftSlot, buildDraft, type CutoutDraftBook } from '../../cutout/draft';
import { modelWorkId, bakeOverlayFromDocument } from '../../cutout/models';
import { PAINT_DOC_KIND, PAINT_DOC_VERSION, type PaintDocument } from '../../paint/layers';
import { draftToDocument } from '../../characters/draft';
import { generateCharacterDraft } from '../../characters/generate';
import { applyBodyPaint } from '../../../game/figure/body';

// a tiny real PaintDocument: one layer, left half of an 8×4 canvas painted
function paintedDoc(): PaintDocument {
  return {
    kind: PAINT_DOC_KIND, version: PAINT_DOC_VERSION,
    dims: { w: 8, h: 4 },
    layers: [{
      id: 'A', name: 'A', groupName: null,
      config: { mode: 'rainbow', blend: 'normal', hueOffset: 0, phaseOffset: 0, muted: false, colors: ['#ff0000'], dim: 0.85 },
      base: { w: 8, h: 4, rows: [[[4, 1], [4, 0]], [[4, 1], [4, 0]], [[4, 1], [4, 0]], [[4, 1], [4, 0]]] },
      brush: null, clicks: [],
    }],
    activeLayer: 0, tool: 'brush', mode: 'erase', brushPx: 8,
    defaults: { mode: 'rainbow', colors: ['#ffffff'], hueOffset: 0, phaseOffset: 0, dim: 0.85 },
    customSurfaces: [],
  } as unknown as PaintDocument;
}

type Rec = {
  lib: Array<{ e: any; label: string }>;
  fig: Array<{ e: any; label: string }>;
  veh: Array<{ e: any; label: string }>;
  mat: Array<{ name: string; recipe: string }>;
  adopt: Array<{ docId: string }>;
  notes: string[];
};

function rig(opts?: { bookSeed?: (book: CutoutDraftBook) => CutoutDraftBook }) {
  const rec: Rec = { lib: [], fig: [], veh: [], mat: [], adopt: [], notes: [] };
  let libState: CutoutStreamState = cutoutStream.initial();
  const figDoc = draftToDocument(generateCharacterDraft(7), 'alpha');
  // the saved overlay carries its re-edit document (the reopen law)
  const paintedFig = applyBodyPaint(figDoc, 'torso', bakeOverlayFromDocument(paintedDoc(), 99));
  const figures = { characters: { 'chr-a': paintedFig } as Record<string, any>, order: ['chr-a'] };
  const vehicles = { vehicles: { 'veh-a': { kind: 'vehicle', id: 'veh-a' } as any }, order: ['veh-a'] };
  let book: CutoutDraftBook = opts?.bookSeed ? opts.bookSeed(emptyDraftBook()) : emptyDraftBook();

  const deps: PaintBenchDeps = {
    library: { state: () => libState },
    session: {
      commit: (e: any, label: string) => { libState = cutoutStream.apply(libState, e); rec.lib.push({ e, label }); },
      note: (l: string) => rec.notes.push(l),
    },
    error: null,
    figures: { state: () => figures as any },
    vehicles: { state: () => vehicles },
    figureSession: () => ({ commit: (e: any, label: string) => { figures.characters[e.id] = e.doc; rec.fig.push({ e, label }); } }),
    vehicleSession: () => ({ commit: (e: any, label: string) => { vehicles.vehicles[e.id] = e.doc; rec.veh.push({ e, label }); } }),
    materialize: (name, recipe) => { rec.mat.push({ name, recipe }); return { id: `custom:${name}` }; },
    textureById: (id) => (id === 'brick' ? { id, label: 'Brick' } : null),
    catalogs: () => ({ materials: [{ id: 'custom:x', label: 'X' }], recipes: [{ id: 'brick', label: 'Brick' }] }),
    charAdopt: (docId) => rec.adopt.push({ docId }),
    identify: null,
    grayLoad: null,
    book: { read: () => book, write: (b) => { book = b; } },
    draftMs: 0,
  };
  const store = createPaintBenchStore(deps);
  const api: PainterApi = {
    buildDocument: () => paintedDoc(),
    composeExportMask: () => {
      // sized to the LIVE canvas (blank opens clamp to the painter's
      // minSize — a fixed 8×4 mask failed the dims gate); top-left
      // quarter ON at 255 (byte-threshold masks, the scaleMask law)
      const { w, h } = store.work.dims;
      const mask = new Uint8Array(w * h);
      for (let y = 0; y < Math.floor(h / 2); y++) {
        for (let x = 0; x < Math.floor(w / 2); x++) mask[y * w + x] = 255;
      }
      return mask;
    },
    lookColors: () => ['#ff0000'],
  };
  store.painterApi.current = api;
  return { store, rec, figures, vehicles, getBook: () => book, lib: () => libState };
}

test('open round-trip: blank · material · ghost-material degrade', () => {
  const { store } = rig();
  store.open({ kind: 'blank', w: 64, h: 32 });
  assertEqual(`${store.work.dims.w}x${store.work.dims.h}`, '64x32', 'blank carries its size');
  assert(!store.work.model && !store.work.textureId, 'blank is bare');
  const keep = store.work.docId;
  assert(store.open({ kind: 'material', id: 'brick', label: 'Brick' }), 'a registry texture opens');
  assertEqual(store.work.textureId, 'brick', 'the material rides under the paint');
  assert(store.work.docId !== keep, 'a material canvas is a fresh document (paintOnMaterial law)');
  assert(!store.open({ kind: 'material', id: 'ghost', label: '?' }), 'a ghost target refuses');
  assertEqual(store.work.textureId, 'brick', 'the canvas stays put on a ghost open');
});

test('open round-trip: figure part (overlay reopen) and vehicle part', () => {
  const { store } = rig();
  assert(store.open({ kind: 'figure-part', docId: 'chr-a', part: 'torso' }), 'the painted torso opens');
  assertEqual(store.work.docId, modelWorkId({ family: 'figure', docId: 'chr-a', part: 'torso' }), 'work id is the model work id');
  assert(!!store.work.model && store.work.modelBg !== null, 'model context resolved');
  assert(store.work.initial !== null, 'the saved overlay reopens as its document (re-edit law)');
  assertEqual(`${store.work.dims.w}x${store.work.dims.h}`, '512x256', 'figure parts paint the full unwrap');
  assert(store.open({ kind: 'vehicle-part', docId: 'veh-a', part: 'body' }), 'a vehicle part opens');
  assertEqual(store.work.model?.family, 'vehicle', 'the vehicle binding rides the work');
});

test('TATTOODRAFT: an unsaved slot wins over the saved overlay and marks resumed', () => {
  const workId = modelWorkId({ family: 'figure', docId: 'chr-a', part: 'torso' });
  const { store } = rig({
    bookSeed: (b) => upsertDraftSlot(b, workId, buildDraft({
      docId: workId, name: 'chr-a · torso', srcPath: null,
      model: { family: 'figure', docId: 'chr-a', part: 'torso' }, doc: paintedDoc(),
    }), 12),
  });
  // the factory restore already reopened the slot (A10)
  assertEqual(store.work.docId, workId, 'mount restore returns to the slot target');
  assert(store.work.resumed, 'the unsaved draft resumed');
});

test('MATERIALIZE routing: figure save → the characters channel + the open draft adopts', () => {
  const { store, rec, figures } = rig();
  store.open({ kind: 'figure-part', docId: 'chr-a', part: 'lHand' });
  store.onDirty();
  store.saveCurrent();
  assertEqual(rec.fig.length, 1, 'ONE commit on the characters channel');
  assertEqual(rec.fig[0].label, 'chr-a: lHand painted', 'the labeled save');
  assert(!!figures.characters['chr-a'].paint?.lHand, 'the overlay landed on the model document');
  assertEqual(rec.adopt[0]?.docId, 'chr-a', 'the open character draft adopts (K3)');
  assert(!store.edited, 'the save clears edited');
  assertEqual(rec.lib.length, 0, 'nothing leaks to the library stream');
});

test('MATERIALIZE routing: vehicle save → the vehicles channel', () => {
  const { store, rec, vehicles } = rig();
  store.open({ kind: 'vehicle-part', docId: 'veh-a', part: 'door' });
  store.onDirty();
  store.saveCurrent();
  assertEqual(rec.veh.length, 1, 'ONE commit on the vehicles channel');
  assert(!!vehicles.vehicles['veh-a'].paint?.door, 'the livery landed on the vehicle document');
  assertEqual(rec.fig.length, 0, 'never cross-routed');
});

test('MATERIALIZE routing: library save → extract → materialize → the material door; document reopen keeps its id', () => {
  const { store, rec, lib } = rig();
  store.open({ kind: 'blank', w: 8, h: 4 });
  store.onDirty();
  store.saveCurrent();
  assertEqual(rec.lib[rec.lib.length - 1].e.kind, 'saved', 'a plain canvas saves to the library');
  const savedId = rec.lib[rec.lib.length - 1].e.id;
  store.extractCurrent();
  const extracted = rec.lib[rec.lib.length - 1].e;
  assertEqual(extracted.kind, 'extracted', `the selection extracts (status: ${store.status})`);
  store.materializeAsset(extracted.id);
  assertEqual(rec.mat.length, 1, 'the cutout materialized through the material door');
  assertEqual(rec.mat[0].recipe, 'cutout-stencil', 'the stencil recipe');
  // reopen the saved document — same id (re-saves upsert)
  assert(store.open({ kind: 'document', id: savedId }), 'the saved document reopens');
  assertEqual(store.work.docId, savedId, 'reopen keeps the id');
  // a cutout reopens as a NEW document
  const asset = libraryCutouts(lib())[0];
  store.open({ kind: 'cutout', id: asset.id });
  assert(store.work.docId !== asset.id && store.work.initial !== null, 'a cutout opens as a fresh document with its layers');
});

test('roster row encoding round-trips every family', () => {
  const partFor = () => 'torso';
  const cases: PaintTarget[] = [
    { kind: 'blank' },
    { kind: 'material', id: 'brick', label: 'Brick' },
    { kind: 'figure-part', docId: 'chr-a', part: 'torso' as any },
    { kind: 'vehicle-part', docId: 'veh-a', part: 'torso' },
    { kind: 'document', id: 'doc-1' },
    { kind: 'cutout', id: 'cut-1' },
  ];
  for (const t of cases) {
    const back = decodeTargetRow(encodeTargetRow(t), partFor);
    assertEqual(back?.kind, t.kind, `${t.kind} survives the row round-trip`);
  }
  assertEqual(decodeTargetRow('garbage', partFor), null, 'junk rows decode to null');
});

finish('editors/workbench/paint');
