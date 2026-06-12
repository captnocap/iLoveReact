// bench.test.ts — P4 behavior tests for the AGNOSTIC paint bench
// (AGNOSTICPAINT-0606): target-open round-trip PER FAMILY (blank / material /
// figure-part / vehicle-part / document / cutout) and MATERIALIZE
// routing per consumer (figure → characters channel + char adopt; vehicle →
// vehicles channel; cutout asset → the material door; else → the library).
// Headless: recorders stand in for every wire; the fake library channel
// FOLDS commits through cutoutStream.apply, so save→reopen is a real
// round-trip.

import { assert, assertEqual, finish, test } from '../../../game/_testkit';
import { cleanImagePath, createPaintBenchStore, type PaintBenchDeps, type PainterApi } from './store';
import { resolveTarget, encodeTargetRow, decodeTargetRow, type PaintTarget } from './targets';
import { cutoutStream, libraryCutouts, libraryDocuments, type CutoutStreamState } from '../../cutout/stream';
import { emptyDraftBook, upsertDraftSlot, buildDraft, type CutoutDraftBook } from '../../cutout/draft';
import { modelWorkId, bakeOverlayFromDocument } from '../../cutout/models';
import { PAINT_DOC_KIND, PAINT_DOC_VERSION, type PaintDocument } from '../../paint/layers';
import { draftToDocument } from '../../characters/draft';
import { generateCharacterDraft } from '../../characters/generate';
import { applyBodyPaint } from '../../../game/figure/body';

function solidLayer(id: string, name: string, w: number, h: number): PaintDocument['layers'][number] {
  return {
    id, name, groupName: null,
    config: { mode: 'solid', blend: 'normal', hueOffset: 0, phaseOffset: 0, muted: false, colors: ['#ff0000'], dim: 1 },
    base: { w, h, rows: Array.from({ length: h }, () => [[Math.max(1, Math.floor(w / 2)), 1], [Math.max(0, w - Math.floor(w / 2)), 0]]) },
    brush: null, clicks: [],
  } as PaintDocument['layers'][number];
}

function imageLayer(path: string, name: string, w: number, h: number): PaintDocument['layers'][number] {
  return {
    id: 'img', name, groupName: 'image',
    config: { mode: 'solid', blend: 'normal', hueOffset: 0, phaseOffset: 0, muted: false, colors: ['#ffffff'], dim: 1 },
    image: { path, name, dims: { w, h } },
    base: null, brush: null, clicks: [],
  } as PaintDocument['layers'][number];
}

function paintDocWithLayers(w: number, h: number, layers: PaintDocument['layers']): PaintDocument {
  return {
    kind: PAINT_DOC_KIND, version: PAINT_DOC_VERSION,
    dims: { w, h }, layers,
    activeLayer: layers.length - 1, tool: 'brush', mode: 'erase', brushPx: 8,
    defaults: { mode: 'solid', colors: ['#ffffff'], hueOffset: 0, phaseOffset: 0, dim: 1 },
    customSurfaces: [],
  } as unknown as PaintDocument;
}

// a tiny real PaintDocument: one layer, left half of an 8×4 canvas painted
function paintedDoc(): PaintDocument {
  const w = 8, h = 4;
  return paintDocWithLayers(w, h, [{
    ...solidLayer('A', 'A', w, h),
    config: { mode: 'rainbow', blend: 'normal', hueOffset: 0, phaseOffset: 0, muted: false, colors: ['#ff0000'], dim: 0.85 },
  }]);
}

type Rec = {
  lib: Array<{ e: any; label: string }>;
  fig: Array<{ e: any; label: string }>;
  veh: Array<{ e: any; label: string }>;
  mat: Array<{ name: string; recipe: string; underlayId?: string | null }>;
  dec: Array<{ name: string; doc: any }>;
  adopt: Array<{ docId: string }>;
  notes: string[];
};

function rig(opts?: { bookSeed?: (book: CutoutDraftBook) => CutoutDraftBook; noFigures?: boolean; identify?: (path: string) => Promise<{ w: number; h: number } | null> }) {
  const rec: Rec = { lib: [], fig: [], veh: [], mat: [], dec: [], adopt: [], notes: [] };
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
    figures: { state: () => (opts?.noFigures ? { characters: {}, order: [] } : figures) as any },
    vehicles: { state: () => vehicles },
    figureSession: () => ({ commit: (e: any, label: string) => { figures.characters[e.id] = e.doc; rec.fig.push({ e, label }); } }),
    vehicleSession: () => ({ commit: (e: any, label: string) => { vehicles.vehicles[e.id] = e.doc; rec.veh.push({ e, label }); } }),
    materialize: (name, recipe, _data, opts) => { rec.mat.push({ name, recipe, underlayId: opts?.underlayId ?? null }); return { id: `custom:${name}` }; },
    materializeDecal: (name, doc) => { rec.dec.push({ name, doc }); return { id: `custom:${name}` }; },
    textureById: (id) => (id === 'brick' ? { id, label: 'Brick' } : null),
    catalogs: () => ({ materials: [{ id: 'custom:x', label: 'X' }], recipes: [{ id: 'brick', label: 'Brick' }] }),
    charAdopt: (docId) => rec.adopt.push({ docId }),
    identify: opts?.identify ?? null,
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
    addImageLayer: () => 0,
    undo: () => {},
    redo: () => {},
  };
  store.painterApi.current = api;
  return { store, rec, figures, vehicles, getBook: () => book, lib: () => libState };
}

test('open round-trip: blank · material · ghost-material degrade', () => {
  const { store, rec } = rig();
  store.open({ kind: 'blank', w: 64, h: 32 });
  assertEqual(`${store.work.dims.w}x${store.work.dims.h}`, '64x32', 'blank carries its size');
  assert(!store.work.model && !store.work.textureId, 'blank is bare');
  const keep = store.work.docId;
  assert(store.open({ kind: 'material', id: 'brick', label: 'Brick' }), 'a registry texture opens');
  assertEqual(store.work.textureId, 'brick', 'the material rides under the paint');
  store.onDirty();
  assertEqual(store.materializeCurrent('painted brick'), 'custom:painted brick', 'material target can materialize directly');
  assertEqual(rec.mat[0].underlayId, 'brick', 'materialized paint remembers the material canvas underlay');
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
  assertEqual(rec.mat[0].underlayId ?? null, null, 'a blank canvas has no material underlay');
  // reopen the saved document — same id (re-saves upsert)
  assert(store.open({ kind: 'document', id: savedId }), 'the saved document reopens');
  assertEqual(store.work.docId, savedId, 'reopen keeps the id');
  // a cutout reopens as a NEW document
  const asset = libraryCutouts(lib())[0];
  store.open({ kind: 'cutout', id: asset.id });
  assert(store.work.docId !== asset.id && store.work.initial !== null, 'a cutout opens as a fresh document with its layers');
});

test('IMGLAYER: open image adds a layer on the current target; paint above it saves and reopens in order', async () => {
  let doc = paintDocWithLayers(16, 16, []);
  const { store, rec } = rig({ identify: async () => ({ w: 16, h: 16 }) });
  store.open({ kind: 'blank', w: 16, h: 16 });
  const originalTarget = store.work.docId;
  store.painterApi.current = {
    buildDocument: () => doc,
    composeExportMask: () => new Uint8Array(16 * 16),
    lookColors: () => ['#ffffff'],
    addImageLayer: (path, name, dims) => {
      doc = paintDocWithLayers(16, 16, [
        imageLayer(path, name, dims.w, dims.h),
        { ...solidLayer('stroke', 'Paint over reference', 16, 16), base: null },
      ]);
      return 1;
    },
    undo: () => {},
    redo: () => {},
  };
  await store.openImage('file:///tmp/reference%20face.png');
  assertEqual(store.work.docId, originalTarget, 'opening an image keeps the current paint target');
  assertEqual(store.work.srcPath, null, 'the image is not promoted to the target srcPath');

  doc = paintDocWithLayers(16, 16, [
    doc.layers[0],
    solidLayer('stroke', 'Paint over reference', 16, 16),
  ]);
  store.onDirty();
  store.saveCurrent();

  const saved = rec.lib.find((r) => r.e.kind === 'saved')?.e;
  assert(!!saved, 'the normal save path receives the document');
  assertEqual(saved.doc.layers.length, 2, 'image layer + paint layer both persisted');
  assertEqual(saved.doc.layers[0].image?.path, '/tmp/reference face.png', 'image layer path persists in the layer');
  assertEqual(saved.doc.layers[1].name, 'Paint over reference', 'paint layer remains above the image');
  assert(store.open({ kind: 'document', id: saved.id }), 'saved document reopens');
  assertEqual(store.work.initial?.layers[0].image?.path, '/tmp/reference face.png', 'reload restores the image layer');
  assertEqual(store.work.initial?.layers[1].name, 'Paint over reference', 'reload restores the stroke layer above');
});

// req_0697 — the IMAGE leg of the material vocabulary: image layers ride the
// decal pipeline at materialize (a full-bleed image node per layer), and the
// painted stencil stacks over them via underlayId. Pure-image canvases (no
// strokes) materialize as the image decal directly.
test('IMGMAT: image + strokes materializes the image as a decal underlay beneath the stencil', () => {
  const { store, rec } = rig();
  store.open({ kind: 'blank', w: 16, h: 16 });
  const base = store.painterApi.current!;
  store.painterApi.current = {
    ...base,
    buildDocument: () => paintDocWithLayers(16, 16, [
      imageLayer('/tmp/brickwall.png', 'brickwall', 16, 16),
      solidLayer('stroke', 'Paint over brickwall', 16, 16),
    ]),
  };
  store.onDirty();
  assertEqual(store.materializeCurrent('graffiti wall'), 'custom:graffiti wall', 'the stencil id returns');
  assertEqual(rec.dec.length, 1, 'the image went through the decal door');
  assertEqual(rec.dec[0].name, 'graffiti wall image', 'the image material carries the work name');
  assertEqual(rec.dec[0].doc.nodes.length, 1, 'one node per image layer');
  assertEqual(rec.dec[0].doc.nodes[0].kind, 'image', 'the node is an image node');
  assertEqual(rec.dec[0].doc.nodes[0].src, '/tmp/brickwall.png', 'the node carries the layer path');
  assertEqual(`${rec.dec[0].doc.nodes[0].w}x${rec.dec[0].doc.nodes[0].h}`, '16x16', 'the image node is full-bleed');
  assertEqual(rec.mat[0].underlayId, 'custom:graffiti wall image', 'the stencil stacks over the image underlay');
});

test('IMGMAT: a pure image canvas (no strokes) materializes as the image material itself', () => {
  const { store, rec } = rig();
  store.open({ kind: 'blank', w: 16, h: 16 });
  const base = store.painterApi.current!;
  store.painterApi.current = {
    ...base,
    buildDocument: () => paintDocWithLayers(16, 16, [imageLayer('/tmp/poster.png', 'poster', 16, 16)]),
    composeExportMask: () => new Uint8Array(16 * 16), // nothing painted
  };
  store.onDirty();
  assertEqual(store.materializeCurrent('lobby poster'), 'custom:lobby poster image', 'the image material id returns');
  assertEqual(rec.dec.length, 1, 'the image went through the decal door');
  assertEqual(rec.mat.length, 0, 'no empty stencil record is minted');
  // a muted image layer does NOT materialize
  store.painterApi.current = {
    ...base,
    buildDocument: () => paintDocWithLayers(16, 16, [
      { ...imageLayer('/tmp/poster.png', 'poster', 16, 16), config: { ...imageLayer('/tmp/poster.png', 'poster', 16, 16).config, muted: true } },
    ]),
    composeExportMask: () => new Uint8Array(16 * 16),
  };
  assertEqual(store.materializeCurrent('hidden poster'), null, 'a muted image layer stays out of the material');
  assertEqual(rec.dec.length, 1, 'no second decal record');
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

// ── DRAFTHOLE-0606: the LAW — no unsaved paint work, on ANY target family,
// dies to a hot update. rig() over the same book IS a hot update (the live
// singleton re-creates and mount-restores from the book). One test per
// reachable family; image needs a real identify door (no-op in the rig —
// its slot path is the same non-model branch material/blank pin); document/
// cutout open SAVED work and share the same non-model slot machinery.

test('DRAFTHOLE: figure part — stroke → hot update → the painting survives', () => {
  const { store, getBook } = rig();
  store.open({ kind: 'figure-part', docId: 'chr-a', part: 'torso' });
  store.onDirty(); // a stroke (draftMs 0 → synchronous slot write)
  const { store: reborn } = rig({ bookSeed: () => getBook() });
  assertEqual(reborn.work.docId, modelWorkId({ family: 'figure', docId: 'chr-a', part: 'torso' }), 'the figure target restores');
  assert(!!reborn.work.initial && reborn.work.initial.layers.length > 0, 'the strokes survive');
  assert(reborn.edited, 'restored work counts as unsaved');
});

test('DRAFTHOLE: vehicle part — stroke → hot update → the painting survives', () => {
  const { store, getBook } = rig();
  store.open({ kind: 'vehicle-part', docId: 'veh-a', part: 'body' });
  store.onDirty();
  const { store: reborn } = rig({ bookSeed: () => getBook() });
  assertEqual(reborn.work.model?.family, 'vehicle', 'the vehicle target restores');
  assert(!!reborn.work.initial && reborn.work.initial.layers.length > 0, 'the strokes survive');
});

test('DRAFTHOLE: material — stroke → hot update → the painting survives over its shader', () => {
  const { store, getBook } = rig();
  store.open({ kind: 'material', id: 'brick', label: 'Brick' });
  store.onDirty();
  const { store: reborn } = rig({ bookSeed: () => getBook() });
  assertEqual(reborn.work.textureId, 'brick', 'the material binding restores');
  assert(!!reborn.work.initial && reborn.work.initial.layers.length > 0, 'the strokes survive');
});

test('DRAFTHOLE: blank canvas — stroke → hot update → the painting survives', () => {
  const { store, getBook } = rig();
  store.open({ kind: 'blank', w: 64, h: 32 });
  store.onDirty();
  const { store: reborn } = rig({ bookSeed: () => getBook() });
  assert(!!reborn.work.initial && reborn.work.initial.layers.length > 0, 'the strokes survive');
  assertEqual(`${reborn.work.dims.w}x${reborn.work.dims.h}`, '8x4', 'the document carries its own dims');
});

test('DRAFTHOLE: an empty painter can NEVER clobber a painted slot (the user\'s loss)', () => {
  const { store, getBook } = rig();
  store.open({ kind: 'figure-part', docId: 'chr-a', part: 'torso' });
  store.onDirty(); // the painted slot exists
  const key = store.work.docId;
  // the degenerate race: a painter that hasn't rehydrated yet reports a
  // layer-less document; its slot write must be REFUSED
  const realDoc = (store.painterApi.current as PainterApi).buildDocument() as PaintDocument;
  store.painterApi.current = {
    buildDocument: () => ({ ...realDoc, layers: [] } as PaintDocument),
    composeExportMask: () => null,
    lookColors: () => [],
    addImageLayer: () => 0,
    undo: () => {},
    redo: () => {},
  } as PainterApi;
  store.onDirty();
  const slot = getBook().slots[key];
  assert(!!slot && slot.doc.layers.length > 0, 'the painted slot refused the empty document');
});

test('DRAFTHOLE: a vanished model keeps its binding through the degrade — the restore self-heals', () => {
  // paint a figure part, hot-update into a world where the roster is EMPTY
  // (deleted doc / channel not yet ingested — the V20 race)
  const { store, getBook } = rig();
  store.open({ kind: 'figure-part', docId: 'chr-a', part: 'torso' });
  store.onDirty();
  const { store: degraded, getBook: getBook2 } = rig({ bookSeed: () => getBook(), noFigures: true });
  assert(degraded.work.model === null, 'the painting degrades to a plain canvas (it SURVIVES)');
  assert(!!degraded.work.initial && degraded.work.initial.layers.length > 0, 'the strokes are intact');
  degraded.onDirty(); // a stroke while degraded — the slot rewrites
  const slot = getBook2().slots[degraded.work.docId];
  assert(!!slot.model && (slot.model as any).docId === 'chr-a', 'the model binding SURVIVES the degraded slot write');
  // the roster returns (next hot update) — the model target re-resolves
  const { store: healed } = rig({ bookSeed: () => getBook2() });
  assertEqual(healed.work.model?.family, 'figure', 'the binding re-resolves once the roster is back');
  assert(!!healed.work.initial && healed.work.initial.layers.length > 0, 'nothing was lost across the whole episode');
});

test('IMGOPEN: picker and drop share one path cleaner — quotes, file://, whitespace', () => {
  assertEqual(cleanImagePath('  /home/u/pic.png  '), '/home/u/pic.png', 'whitespace trims');
  assertEqual(cleanImagePath('"/home/u/my pic.png"'), '/home/u/my pic.png', 'shell quotes strip');
  assertEqual(cleanImagePath("'/home/u/pic.png'"), '/home/u/pic.png', 'single quotes strip');
  assertEqual(cleanImagePath('file:///home/u/pic%20name.png'), '/home/u/pic name.png', 'DE file:// drops decode');
  assertEqual(cleanImagePath('/plain/path.png'), '/plain/path.png', 'clean input passes through');
});

finish('editors/workbench/paint');
