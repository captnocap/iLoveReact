// editors/workbench/paint/store.ts — the agnostic paint bench's state truth
// (AGNOSTICPAINT-0606; parity rows A1-A10, B1-B5, C1-C6 in
// ../AGNOSTICPAINT.CAPTURE.md).
//
// CutoutRoute.tsx's route-level machinery as a headless store: ONE working
// target (any PaintTarget), the library, the workbench-scoped draft book
// (K5 — its own file, never cutout's), and MATERIALIZE — the routing verb:
// save/extract route output to the consumer the subject implies
//   figure part  → applyBodyPaint    → the characters channel (+ the open
//                                      character draft adopts — the K3 law)
//   vehicle part → applyVehiclePaint → the vehicles channel
//   cutout asset → saveCustomTexture → the material catalog (faces/tiles)
//   anything else → the cutout library stream ('saved'/'extracted')
// No new persistence — the one surface fronting all the existing doors.
//
// Deps arrive injected (the character store's pattern) so the P4 suite
// drives every routing branch with recorders, headless.

import type { PaintDocument } from '../../paint/layers';
import type { GraySource } from '../../paint/strokes';
import type { Dims } from './targets';
import {
  bakeOverlayFromDocument, emptyModelDocument, modelWorkId, modelWorkName, takePendingModelTarget,
  type ModelBinding,
} from '../../cutout/models';
import {
  buildDraft, emptyDraftBook, parseDraftBook, serializeDraftBook, upsertDraftSlot,
  draftModelBinding, type CutoutDraftBook,
} from '../../cutout/draft';
import { extractCutout, stencilDataFromAsset, uniqueAssetName, STENCIL_RECIPE_ID } from '../../cutout/extraction';
import { cutoutStream, libraryCutouts, libraryDocuments, type CutoutAsset, type CutoutEvent, type CutoutStreamState } from '../../cutout/stream';
import { charactersStream, type CharactersEvent, type CharactersStreamState } from '../../../game/figure/stream';
import { vehiclesStream } from '../../../game/vehicle/stream';
import { applyVehiclePaint } from '../../../game/vehicle';
import { applyBodyPaint } from '../../../game/figure/body';
import { paintedOverlayHasContent } from '../../../game/painted';
import { resolveTarget, type BenchWork, type PaintTarget, type ResolveDeps, type VehiclesStateLike } from './targets';
import { readFile, writeFile, mkdir, exists } from '@reactjit/hooks/fs';

// K5 ruling: the workbench's OWN slot book (PaintLens.tsx introduced it;
// the bench inherits the same file — one book for the one surface).
export const WB_PAINT_BOOK_PATH = 'cart/hmsc-int/sessions/_workbench_paint_drafts.json';
const WB_PAINT_SLOTS_CAP = 12;
const WB_DRAFT_DEBOUNCE_MS = 600;

export type Commitish = { commit(e: any, label: string): unknown; note?(label: string): void };

export type PaintBenchDeps = {
  /** the cutout library channel + this surface's session on it */
  library: { state(): CutoutStreamState } | null;
  session: Commitish | null;
  error: string | null;
  /** the model rosters (read) + lazy commit doors (the owning channels) */
  figures: { state(): CharactersStreamState } | null;
  vehicles: { state(): VehiclesStateLike } | null;
  figureSession: (() => Commitish | null) | null;
  vehicleSession: (() => Commitish | null) | null;
  /** materialize door (live: saveCustomTexture) */
  materialize: ((name: string, recipeId: string, data: number[]) => { id: string }) | null;
  /** registry texture lookup + catalogs (live: textures registry) */
  textureById: (id: string) => { id: string; label: string } | null;
  catalogs: () => { materials: Array<{ id: string; label: string }>; recipes: Array<{ id: string; label: string }> };
  /** the open character draft adopts a figure save (K3) — live: the char store */
  charAdopt: ((docId: string, next: any) => void) | null;
  /** CLOTHFLIP-0607 — the garment-design family's own doors (additive):
   *  label lookup gates resolve; the session lands `garmentVariantSaved`
   *  commits on the clothing-variants channel; designs feed re-edit opens.
   *  Structural types — store.ts stays decoupled from the garment module. */
  garmentLabel?: ((garmentId: string) => string | null) | null;
  garmentDesigns?: { state(): { variants: Record<string, Array<{ id: string; label: string; overlay?: unknown }>> } } | null;
  garmentSession?: (() => Commitish | null) | null;
  /** image identify (async, host) — live: cutout/sources identifyImage */
  identify: ((path: string) => Promise<Dims | null>) | null;
  /** gray source for smart select — live: cutout/sources loadGraySource */
  grayLoad: ((path: string, dims: Dims) => Promise<GraySource | null>) | null;
  /** draft book io — live: the workbench book file; tests: a bag */
  book?: { read(): CutoutDraftBook; write(b: CutoutDraftBook): void };
  fileExists?: (path: string) => boolean;
  draftMs?: number; // <=0 → synchronous slot writes (tests)
};

export type PainterApi = {
  buildDocument: () => PaintDocument | null;
  composeExportMask: () => Uint8Array | null;
  lookColors: () => string[];
  addImageLayer: (path: string, name: string, dims: Dims) => number;
  undo: () => void;
  redo: () => void;
};

function liveBook() {
  return {
    read(): CutoutDraftBook {
      try {
        const text = readFile(WB_PAINT_BOOK_PATH);
        return (text ? parseDraftBook(text) : null) ?? emptyDraftBook();
      } catch { return emptyDraftBook(); }
    },
    write(book: CutoutDraftBook): void {
      try {
        mkdir('cart/hmsc-int/sessions');
        writeFile(WB_PAINT_BOOK_PATH, serializeDraftBook(book));
      } catch { /* fs-less host */ }
    },
  };
}

/** IMGOPEN-0606: picker/drop paths arrive messy — quoted (some shell picker
 *  idioms), file://-prefixed (DE drops), or whitespace-wrapped. The cleaner
 *  sits INSIDE openImage so picker and drop share one load path. Headless +
 *  pure (the P4 suite pins it). */
export function cleanImagePath(raw: string): string {
  let p = raw.trim().replace(/^['"]+|['"]+$/g, '').trim();
  if (p.startsWith('file://')) p = decodeURIComponent(p.slice('file://'.length));
  return p;
}

function dropSlot(book: CutoutDraftBook, key: string): CutoutDraftBook {
  const slots = { ...book.slots };
  delete slots[key];
  return { ...book, order: book.order.filter((k) => k !== key), slots };
}

export function createPaintBenchStore(deps: PaintBenchDeps) {
  const book = deps.book ?? liveBook();
  const fileExists = deps.fileExists ?? ((p: string) => { try { return exists(p); } catch { return false; } });
  const draftMs = deps.draftMs ?? WB_DRAFT_DEBOUNCE_MS;

  const listeners = new Set<() => void>();
  const emit = () => { for (const fn of [...listeners]) fn(); };

  // ── state ──────────────────────────────────────────────────────────────────
  let work: BenchWork & { epoch: number } = { ...blankResolve(), epoch: 0 };
  let edited = false;
  let lastSavedAt: number | null = null;
  let status = 'blank canvas — pick anything in the roster, or drop an image';
  let libRev = 0;
  /** the last successfully-opened target — the hero's materialize/remove
   *  verbs act on the LIBRARY ROW the subject came from */
  let lastTarget: PaintTarget | null = null;
  let gray: GraySource | null = null;
  let grayEpoch = 0;
  /** the live painter lifts its doors here (cutout's painterApi idiom) */
  const painterApi: { current: PainterApi | null } = { current: null };

  function blankResolve(): BenchWork {
    return resolveTarget({ kind: 'blank' }, resolveDeps())!;
  }

  function resolveDeps(): ResolveDeps {
    return {
      figures: deps.figures?.state() ?? null,
      vehicles: deps.vehicles?.state() ?? null,
      library: deps.library?.state() ?? null,
      textureById: deps.textureById,
      slotDoc: (workId) => book.read().slots[workId]?.doc ?? null,
      garmentLabel: (id) => deps.garmentLabel?.(id) ?? null,
      garmentDesign: (garmentId, designId) => {
        const v = deps.garmentDesigns?.state().variants[garmentId]?.find((x) => x.id === designId);
        return v?.overlay ? { label: v.label, overlay: v.overlay } : null;
      },
    };
  }

  // ── the draft book (C3 — TATTOODRAFT, edited gate, flush-before-switch) ────
  // DRAFTHOLE-0606: when a model slot's roster doc can't resolve at restore
  // (deleted, or the channel hadn't ingested yet), the painting degrades to
  // a plain canvas — but the BINDING must survive into every later slot
  // write, so the next restore can re-resolve the model (self-healing).
  let orphanModel: ReturnType<typeof draftModelBinding> = null;
  let draftTimer: ReturnType<typeof setTimeout> | null = null;
  const writeDraftSlot = (nameOverride?: string) => {
    const doc = painterApi.current?.buildDocument() ?? null;
    if (!doc) return;
    // DRAFTHOLE-0606 (the user's loss, the book's smoking gun: layers=0
    // written over painted work): a degenerate layer-less document must
    // NEVER clobber a slot holding real painted layers.
    const existing = book.read().slots[work.docId];
    if (doc.layers.length === 0 && (existing?.doc?.layers?.length ?? 0) > 0) return;
    book.write(upsertDraftSlot(
      book.read(),
      work.docId,
      buildDraft({ docId: work.docId, name: nameOverride ?? work.name, srcPath: work.srcPath, textureId: work.textureId, model: work.model ?? orphanModel, doc }),
      WB_PAINT_SLOTS_CAP,
    ));
  };
  const flushDraft = (nameOverride?: string) => {
    // only a painted target earns a slot — a pristine open-and-leave must
    // never evict someone's real unsaved work (CutoutRoute:336-342)
    if (!draftTimer && !edited) return;
    if (draftTimer) { clearTimeout(draftTimer); draftTimer = null; }
    writeDraftSlot(nameOverride);
  };
  const onDirty = () => {
    edited = true;
    if (draftMs <= 0) { writeDraftSlot(); emit(); return; }
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(() => { draftTimer = null; writeDraftSlot(); }, draftMs);
    emit();
  };

  const setStatus = (s: string) => { status = s; emit(); };
  const undo = () => {
    const api = painterApi.current;
    if (!api) { setStatus('painter not ready — try again after the canvas appears'); return; }
    api.undo();
  };
  const redo = () => {
    const api = painterApi.current;
    if (!api) { setStatus('painter not ready — try again after the canvas appears'); return; }
    api.redo();
  };

  // ── gray source (A3) — async per target ────────────────────────────────────
  const loadGray = () => {
    gray = null;
    const path = work.srcPath;
    const epoch = ++grayEpoch;
    if (!path || !deps.grayLoad) return;
    void deps.grayLoad(path, work.dims).then((g) => {
      if (g && epoch === grayEpoch) { gray = g; emit(); }
    });
  };

  // ── open ANY target (the agnostic door) ────────────────────────────────────
  const install = (next: BenchWork, note?: string) => {
    work = { ...next, epoch: work.epoch + 1 };
    edited = !!next.initial && next.resumed; // a resumed slot counts as edited (it IS unsaved work)
    orphanModel = null; // a real open replaces the degraded context
    loadGray();
    if (note) { deps.session?.note?.(note); }
    emit();
  };

  const open = (target: PaintTarget): boolean => {
    flushDraft();
    const next = resolveTarget(target, resolveDeps());
    if (!next) { setStatus('that target is gone — the canvas stays put'); return false; }
    lastTarget = target;
    install(next, `open · ${next.name}`);
    if (next.model) {
      // OPEN-SLOT (A5): the TARGET itself survives a hot update before the
      // first stroke — record the slot now (painting or open-intent)
      book.write(upsertDraftSlot(
        book.read(),
        next.docId,
        buildDraft({ docId: next.docId, name: next.name, srcPath: null, model: next.model, doc: next.initial ?? emptyModelDocument(next.dims) }),
        WB_PAINT_SLOTS_CAP,
      ));
      setStatus(`painting ${next.model.family} ${next.model.docId} · ${next.model.part}${next.resumed ? ' (unsaved draft resumed)' : next.initial ? ' (reopened)' : ''}`);
    } else {
      setStatus(`${target.kind === 'blank' ? 'new canvas' : `opened ${next.name}`} · ${next.dims.w}×${next.dims.h}`);
    }
    return true;
  };

  const newCanvas = (w: number, h: number) => { open({ kind: 'blank', w, h }); };

  const openImage = async (path: string) => {
    const clean = cleanImagePath(path);
    if (!clean || !deps.identify) return;
    setStatus(`reading ${clean}…`);
    const dims = await deps.identify(clean);
    // IMGOPEN-0606: fail LOUD and point at the two doors that work.
    if (!dims) { setStatus(`could not read image: ${clean} — use the open-image picker or drop the file onto the canvas`); return; }
    const base = clean.split('/').pop() ?? clean;
    const name = base.replace(/\.[^.]+$/, '') || 'image';
    const api = painterApi.current;
    if (!api) { setStatus('painter not ready — try again after the canvas appears'); return; }
    api.addImageLayer(clean, name, dims);
    edited = true;
    onDirty();
    setStatus(`added image layer · ${name}`);
  };

  // ── rename (C2) ────────────────────────────────────────────────────────────
  let committedName = work.name;
  const rename = (name: string) => { work = { ...work, name }; emit(); };
  const commitName = (name?: string) => {
    const clean = (name ?? work.name).trim() || 'untitled';
    if (work.name !== clean) { work = { ...work, name: clean }; }
    if (committedName === clean) { emit(); return; }
    committedName = clean;
    deps.session?.note?.(`rename work · ${clean}`);
    setStatus(`renamed ${clean}`);
    flushDraft(clean);
  };

  // ── output routing — MATERIALIZE is the verb (B1-B5) ──────────────────────
  const saveCurrent = () => {
    if (!edited) { setStatus('nothing to save yet — paint something first'); return; }
    if (work.garment) { saveGarmentDesign(work.garment); return; }
    if (work.model) { saveModelPaint(work.model); return; }
    const doc = painterApi.current?.buildDocument() ?? null;
    if (!doc || !deps.session) { setStatus('nothing to save'); return; }
    const name = work.name.trim() || 'untitled';
    deps.session.commit(
      { kind: 'saved', id: work.docId, name, srcPath: work.srcPath, textureId: work.textureId, doc },
      `save · ${name} · ${doc.dims.w}×${doc.dims.h} · ${doc.layers.length} layer${doc.layers.length === 1 ? '' : 's'}`,
    );
    libRev += 1;
    lastSavedAt = Date.now();
    setStatus(`saved ${name}`);
  };

  // CLOTHFLIP-0607 — the garment family's consumer (the user's spine:
  // "add a new design, brings me to the painter save, done now that shirt
  // exists"): bake the document to a PaintedOverlay (the model-paint bake,
  // one truth) and land ONE `garmentVariantSaved` commit on the
  // clothing-variants channel. The first save MINTS the design id and the
  // work adopts it, so every later save UPSERTS the same design (A7's law).
  let designSeq = 0;
  const saveGarmentDesign = (g: { garmentId: string; designId: string | null }) => {
    const doc = painterApi.current?.buildDocument() ?? null;
    if (!doc) { setStatus('nothing to save'); return; }
    const session = deps.garmentSession?.();
    if (!session) { setStatus('garment designs unavailable — the clothing-variants channel is down'); return; }
    const overlay = bakeOverlayFromDocument(doc, Date.now());
    if (!paintedOverlayHasContent(overlay)) { setStatus('nothing painted yet — the design needs at least one stroke'); return; }
    const designId = g.designId ?? `dsn-${Date.now().toString(36)}${(designSeq++).toString(36)}`;
    const label = work.name.trim() || 'untitled design';
    session.commit(
      { kind: 'garmentVariantSaved', garmentId: g.garmentId, variant: { id: designId, label, overlay } },
      `${g.garmentId}: design ${label} saved`,
    );
    // the 'new' slot's work would now only shadow the saved design
    if (draftTimer) { clearTimeout(draftTimer); draftTimer = null; }
    book.write(dropSlot(book.read(), work.docId));
    work = { ...work, garment: { garmentId: g.garmentId, designId }, docId: `gdsn:${g.garmentId}:${designId}`, name: label };
    edited = false;
    libRev += 1;
    lastSavedAt = Date.now();
    setStatus(`design saved · ${label} — the ${g.garmentId.split(':')[1] ?? g.garmentId} wears it`);
  };

  const saveModelPaint = (binding: ModelBinding) => {
    const doc = painterApi.current?.buildDocument() ?? null;
    if (!doc) { setStatus('nothing to save'); return; }
    const overlay = bakeOverlayFromDocument(doc, Date.now());
    const has = paintedOverlayHasContent(overlay);
    if (binding.family === 'figure') {
      const session = deps.figureSession?.();
      const model = deps.figures?.state().characters[binding.docId];
      if (!session || !model) { setStatus(`figure ${binding.docId} unavailable`); return; }
      const next = applyBodyPaint(model, binding.part as any, has ? overlay : null);
      session.commit({ kind: 'authored', id: binding.docId, doc: next },
        `${binding.docId}: ${binding.part} ${has ? 'painted' : 'paint cleared'}`);
      // K3: the open character draft adopts the committed paint
      deps.charAdopt?.(binding.docId, next);
    } else {
      const session = deps.vehicleSession?.();
      const model = deps.vehicles?.state().vehicles[binding.docId];
      if (!session || !model) { setStatus(`vehicle ${binding.docId} unavailable`); return; }
      const next = applyVehiclePaint(model, binding.part as any, has ? overlay : null);
      session.commit({ kind: 'authored', id: binding.docId, doc: next },
        `${binding.docId}: ${binding.part} ${has ? 'painted' : 'paint cleared'}`);
    }
    // the save landed on the model — its slot would now only shadow it
    if (draftTimer) { clearTimeout(draftTimer); draftTimer = null; }
    book.write(dropSlot(book.read(), modelWorkId(binding)));
    edited = false;
    libRev += 1; // painted dots refresh
    lastSavedAt = Date.now();
    setStatus(has ? `painted ${binding.part} saved to ${binding.docId}` : `cleared ${binding.part} paint on ${binding.docId}`);
  };

  const extractCurrent = () => {
    if (!edited) { setStatus('nothing selected — paint or smart-select a region first'); return; }
    const mask = painterApi.current?.composeExportMask() ?? null;
    if (!mask || !deps.session) { setStatus('nothing to extract'); return; }
    const lib = deps.library?.state() ?? null;
    const taken = lib ? libraryCutouts(lib).map((c) => c.name) : [];
    const asset = extractCutout({
      name: uniqueAssetName(work.name, taken),
      dims: work.dims,
      mask,
      srcPath: work.srcPath,
      textureId: work.textureId,
      colors: painterApi.current?.lookColors(),
      docId: work.docId,
    });
    if (!asset) { setStatus('nothing selected — paint or smart-select a region first'); return; }
    deps.session.commit({ kind: 'extracted', id: asset.id, asset }, `cutout · ${asset.name} · ${asset.pixels}px`);
    libRev += 1;
    lastSavedAt = Date.now();
    setStatus(`extracted ${asset.name} · ${asset.pixels}px`);
  };

  const materializeAsset = (assetId: string) => {
    const lib = deps.library?.state() ?? null;
    const asset = lib ? libraryCutouts(lib).find((c) => c.id === assetId) : null;
    if (!asset || !deps.materialize) { setStatus('nothing to materialize'); return; }
    const record = deps.materialize(asset.name, STENCIL_RECIPE_ID, stencilDataFromAsset(asset));
    deps.session?.note?.(`materialized · ${asset.name} → ${record.id}`);
    setStatus(`material saved · ${record.id} — assignable in /textures and on faces/tiles`);
  };

  const removeEntry = (id: string, target: 'document' | 'cutout', name: string) => {
    if (!deps.session) return;
    deps.session.commit({ kind: 'removed', id, target }, `remove ${target} · ${name}`);
    libRev += 1;
    setStatus(`removed ${name}`);
  };

  // ── mount restore (A10) — the book's current slot, model-rebound live ──────
  {
    const current = book.read();
    const key = current.order[current.order.length - 1];
    const slot = key ? current.slots[key] : null;
    if (slot) {
      const binding = draftModelBinding(slot);
      if (binding) {
        const restored = resolveTarget(
          binding.family === 'figure'
            ? { kind: 'figure-part', docId: binding.docId, part: binding.part }
            : { kind: 'vehicle-part', docId: binding.docId, part: binding.part },
          resolveDeps(),
        );
        if (restored) {
          work = { ...restored, epoch: 0 };
          edited = restored.resumed;
          status = `restored working draft · ${restored.name}`;
        } else {
          // a vanished model: the PAINTING survives as a plain canvas below,
          // and the binding survives in orphanModel so later slot writes
          // keep it — the next restore re-resolves (DRAFTHOLE-0606)
          orphanModel = binding;
        }
      }
      if (!work.model && slot.doc) {
        const srcOk = slot.srcPath ? fileExists(slot.srcPath) : true;
        work = {
          docId: slot.docId, name: slot.name,
          srcPath: srcOk ? slot.srcPath : null,
          textureId: slot.textureId ?? null,
          model: null, modelBg: null, modelLayers: null,
          dims: { w: slot.doc.dims.w, h: slot.doc.dims.h },
          initial: slot.doc, resumed: true, epoch: 0,
        };
        edited = true;
        status = `restored working draft · ${slot.name}`;
      }
      loadGray();
    }
    // the deep-link mailbox (A9): another surface said "paint this"
    const pending = takePendingModelTarget();
    if (pending) {
      open(pending.family === 'figure'
        ? { kind: 'figure-part', docId: pending.docId, part: pending.part }
        : { kind: 'vehicle-part', docId: pending.docId, part: pending.part });
    }
  }

  return {
    subscribe(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); },
    get work() { return work; },
    get edited() { return edited; },
    get lastSavedAt() { return lastSavedAt; },
    get status() { return status; },
    get libRev() { return libRev; },
    get lastTarget() { return lastTarget; },
    get gray() { return gray; },
    get sessionError() { return deps.error; },
    painterApi,
    // reads for the roster/panel
    library: () => deps.library?.state() ?? null,
    figures: () => deps.figures?.state() ?? null,
    vehicles: () => deps.vehicles?.state() ?? null,
    catalogs: () => deps.catalogs(),
    // doors
    open, openImage, newCanvas,
    rename, commitName,
    onDirty, flushDraft,
    undo, redo,
    saveCurrent, extractCurrent, materializeAsset, removeEntry,
    setStatus,
  };
}

export type PaintBenchStore = ReturnType<typeof createPaintBenchStore>;
