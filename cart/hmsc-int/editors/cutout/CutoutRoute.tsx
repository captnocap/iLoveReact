// editors/cutout/ — the CUTOUT PAINTER route (CUTOUTAPP-0605).
//
// The cutout APP EXPERIENCE remade as its own page in the one shell: the
// full-canvas, layer-stack, smart-select image/texture editor — for
// painting SKINS/TEXTURES, not the map. The engine is editors/paint/ (THE
// shared painter, consumed never forked); this route is the app around it:
// source ingestion (blank canvas / image file), the library of saved
// documents + extracted cutouts on the V20 'cutout' stream, the original
// app's working chrome (tabbed inspector, backend picker, live FX gallery +
// custom-WGSL modal, full layers panel, status bar), working-draft autosave
// (hot reloads and crashes lose nothing), and the route-scoped session
// history. cart/cutout is the behavior reference only (read, never
// imported, never edited — the user deletes it); editors/cutout/CAPTURE.md
// is the app-surface deletion contract.
//
// Session history (the user's ruling, V20): the route opens a SESSION on
// the 'cutout' channel. Strokes / lasso / smart clicks / layer ops land as
// labeled notes (the painter calls session.note per interaction); SAVES and
// EXTRACTIONS are commit-grade — the content event (full document / cutout
// asset) goes to the channel stream and the marker records its position.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Col, Effect, Pressable, Row, ScrollView, Text, TextArea, TextInput } from '@reactjit/primitives';
import { useFileDrop } from '@reactjit/hooks/useFileDrop';
import { exists, mkdir, readFile, writeFile } from '@reactjit/hooks/fs';
import { GAME_CHROME } from '@game';
// The material/shader lab system (the locked art→material pipeline): the one
// texture registry + the studio's stored materials. /cutout participates both
// ways — paint ON a registry texture (the material canvas), and Materialize an
// extracted cutout INTO a stored material (the 'cutout-stencil' recipe).
import { allTextures, textureById } from '../../../hmsc/render3d/textures';
import { saveCustomTexture, useCustomTextures } from '../../../hmsc/render3d/customTextures';
import { editorChannel } from '../store';
import { editorSessions, type RouteSession } from '../sessions';
import { editorTunables } from '../tunables';
import { useRouteTwigState } from '../twigs';
import {
  PAINT, usePaintEditor, PaintSurface, PaintQuad,
  type Dims, type GraySource, type PaintDocument, type PaintSession,
} from '../paint';
import { CutoutToolRail } from './ToolRail';
import {
  cutoutStream, libraryCutouts, libraryDocuments,
  type CutoutAsset, type CutoutEvent, type SavedPaintDoc,
} from './stream';
import {
  cutoutToDocument, extractCutout, mintDocumentId, previewCells,
  stencilDataFromAsset, STENCIL_RECIPE_ID, uniqueAssetName,
} from './extraction';
import { identifyImage, loadGraySource } from './sources';
import {
  buildDraft, currentDraft, draftModelBinding, emptyDraftBook, parseDraft, parseDraftBook,
  removeDraftSlot, serializeDraftBook, upsertDraftSlot,
  CUTOUT_DRAFT_PATH, CUTOUT_DRAFTS_PATH, type CutoutDraft, type CutoutDraftBook,
} from './draft';
import { CutoutInspector, type BackendChoice } from './Inspector';
import { CutoutStatusBar } from './StatusBar';
// MODEL TEXTURE TARGETS (MODELPAINT-0605): pick a face / body part / vehicle
// part, paint it here, save back onto the model document through the doors.
import {
  bakeOverlayFromDocument, emptyModelDocument, modelCanvasBg, modelCanvasDims, modelWorkId,
  modelWorkName, overlayOf, reopenOverlayDocument, slotDocumentHasContent, takePendingModelTarget,
  FIGURE_PAINT_TARGETS, type ModelBinding,
} from './models';
import { applyBodyPaint, applyVehiclePaint, paintedOverlayHasContent, charactersStream, vehiclesStream } from '@game';
import type { BodyDocument, CharactersEvent, VehicleDoc, VehiclesEvent } from '@game';
import { PAINT_TARGET_LABELS, type PaintTargetId, type PartId } from '../../game/figure/shapes';
import type { HedLayer } from '../../game/figure/hed';
import { VEHICLE_PART_IDS, type VehiclePartId } from '../../game/vehicle';
import { FaceLayerPaint } from '../../game/figure/render';
import { ModelPreview3D } from './ModelPreview';

const { Chip } = GAME_CHROME;
const T = GAME_CHROME.tokens.color;

// The route's own view tuning (P2) — chrome sizes only, never paint behavior
// (paint behavior lives in editors/paint/tuning.ts). SETTINGS-0605: the
// numeric leaves register into THE P2 registry below (same values, now
// /settings-editable; the registry writes through, so no freeze).
const VIEW = {
  railWidth: 216,
  headerHeight: 46,
  swatch: 34,
  nameWidth: 150,
  draftDebounceMs: 600,
  /** draft-book slot cap (TATTOODRAFT): how many targets keep an unsaved
   *  in-progress painting at once (MRU eviction beyond it) */
  draftSlots: 12,
  sessionsDir: 'cart/hmsc-int/sessions',
};
editorTunables().register({
  system: 'cutout-view', route: '/cutout', table: VIEW,
  specs: {
    railWidth: { label: 'rail px', min: 140, max: 420, step: 4, precision: 0 },
    headerHeight: { label: 'header px', min: 32, max: 90, step: 2, precision: 0 },
    swatch: { label: 'swatch px', min: 16, max: 96, step: 2, precision: 0 },
    nameWidth: { label: 'name px', min: 80, max: 320, step: 5, precision: 0 },
    draftDebounceMs: { label: 'draft ms', min: 100, max: 5000, step: 100, precision: 0 },
    draftSlots: { label: 'draft slots', min: 1, max: 64, step: 1, precision: 0 },
  },
});

// ── the draft book on disk (TATTOODRAFT) ─────────────────────────────────────
// Read the book; an absent book falls back to the legacy single-draft file
// wrapped as one slot (the pre-book lifeline keeps working across the
// upgrade — addition, not migration).
function readDraftBook(): CutoutDraftBook {
  const text = readFile(CUTOUT_DRAFTS_PATH);
  const book = text ? parseDraftBook(text) : null;
  if (book) return book;
  const legacyText = readFile(CUTOUT_DRAFT_PATH);
  const legacy = legacyText ? parseDraft(legacyText) : null;
  if (legacy) return upsertDraftSlot(emptyDraftBook(), legacy.docId, legacy, VIEW.draftSlots);
  return emptyDraftBook();
}

function writeDraftBook(book: CutoutDraftBook): void {
  mkdir(VIEW.sessionsDir);
  writeFile(CUTOUT_DRAFTS_PATH, serializeDraftBook(book));
}

/** One working target: what's on the canvas right now. A fresh `docId` is a
 *  new library entry; reopening a saved document keeps its id so re-saves
 *  upsert. `epoch` remounts the painter (fresh stack + textures). */
type Work = {
  docId: string;
  name: string;
  srcPath: string | null;
  /** the registry material under the paint (the material canvas), if any */
  textureId: string | null;
  /** MODELPAINT-0605: the model slot under the paint (a figure part or a
   *  vehicle part) — saves apply to the model document, not the library */
  model: ModelBinding | null;
  /** the model canvas context resolved at open (underlay bg + the head's
   *  shape layers so face painting sees the face) */
  modelBg: string | null;
  modelLayers: HedLayer[] | null;
  dims: Dims;
  initial: PaintDocument | null;
  epoch: number;
};

/** What the header actions need from the live painter (lifted via ref — the
 *  paintApiRef idiom, so Save/Extract live in the one header). */
type PainterApi = {
  buildDocument: () => PaintDocument | null;
  composeExportMask: () => Uint8Array | null;
  /** the active look's color slots (stencil fill/bg at extraction) */
  lookColors: () => string[];
};

function freshWork(prev: Work | null, patch: Partial<Omit<Work, 'epoch'>>): Work {
  return {
    docId: patch.docId ?? mintDocumentId(),
    name: patch.name ?? 'untitled',
    srcPath: patch.srcPath ?? null,
    textureId: patch.textureId ?? null,
    model: patch.model ?? null,
    modelBg: patch.modelBg ?? null,
    modelLayers: patch.modelLayers ?? null,
    dims: patch.dims ?? { w: PAINT.tuning.canvas.defaultSize, h: PAINT.tuning.canvas.defaultSize },
    initial: patch.initial ?? null,
    epoch: (prev?.epoch ?? 0) + 1,
  };
}

function stemOf(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.[^.]+$/, '') || 'image';
}

function clampCanvasSize(n: number): number {
  const { minSize, maxSize, defaultSize } = PAINT.tuning.canvas;
  if (!Number.isFinite(n)) return defaultSize;
  return Math.max(minSize, Math.min(maxSize, Math.round(n)));
}

/** Restore the working draft (the autosave lifeline) — boot blank when
 *  there is none or the gate rejects it. A draft whose source image moved
 *  keeps the painted layers and drops the missing image.
 *
 *  HOTDRAFT (MODELPAINT-0605): a draft carrying a model binding restores as
 *  THE MODEL TARGET — the unsaved strokes come back on the same face/part
 *  and the next save still applies to the model. The binding is gated
 *  against the real part vocabularies and re-resolved against the live
 *  store; a model that vanished (or no store host) keeps the PAINTING as a
 *  plain canvas — strokes are never the thing that gets dropped. */
function restoreOrBlank(): Work {
  const draft = currentDraft(readDraftBook())?.draft ?? null;
  if (!draft) return { ...freshWork(null, {}), epoch: 0 };
  const binding = draftModelBinding(draft);
  if (binding) {
    try {
      const model: BodyDocument | VehicleDoc | undefined = binding.family === 'figure'
        ? editorChannel(charactersStream).state().characters[binding.docId]
        : editorChannel(vehiclesStream).state().vehicles[binding.docId];
      if (model) {
        return {
          docId: modelWorkId(binding),
          name: modelWorkName(binding),
          srcPath: null,
          textureId: null,
          model: binding,
          modelBg: modelCanvasBg(binding, model),
          modelLayers: binding.family === 'figure' && binding.part === 'head'
            ? (model as BodyDocument).parts.head.layers
            : null,
          dims: { w: draft.doc.dims.w, h: draft.doc.dims.h },
          // an open-intent placeholder (no strokes yet) restores the TARGET
          // with a fresh canvas — the painter mints its starter layer
          initial: slotDocumentHasContent(draft.doc) ? draft.doc : null,
          epoch: 0,
        };
      }
    } catch {
      // no __fs_* host — fall through to the plain-canvas restore below
    }
  }
  const srcOk = draft.srcPath ? exists(draft.srcPath) : true;
  return {
    docId: draft.docId,
    name: draft.name,
    srcPath: srcOk ? draft.srcPath : null,
    textureId: draft.textureId ?? null,
    model: null,
    modelBg: null,
    modelLayers: null,
    dims: { w: draft.doc.dims.w, h: draft.doc.dims.h },
    initial: draft.doc,
    epoch: 0,
  };
}

export function CutoutRoute(props: { onExit: () => void }) {
  // ── the V20 channel + this visit's session (the characters-route idiom) ───
  const live = useMemo(() => {
    try {
      const channel = editorChannel(cutoutStream);
      return { channel, session: editorSessions().open('/cutout', channel) as RouteSession<CutoutEvent>, error: null as string | null };
    } catch (e) {
      return { channel: null, session: null, error: String(e) };
    }
  }, []);
  useEffect(() => () => live.session?.close(), [live]);
  const [libRev, setLibRev] = useState(0);
  const library = useMemo(
    () => live.channel?.state() ?? cutoutStream.initial(),
    [live, libRev],
  );

  // ── the MODEL channels (MODELPAINT-0605): the rosters this route paints ───
  // editorChannel = the tool's ONE store; saves commit through lazily-opened
  // '/cutout' sessions on the figure/vehicle channels (one labeled commit
  // per save — it rides the same global chain and shows in the bus).
  const models = useMemo(() => {
    try {
      return { figures: editorChannel(charactersStream), vehicles: editorChannel(vehiclesStream) };
    } catch {
      return { figures: null, vehicles: null };
    }
  }, []);
  const modelSessions = useRef<{ figure: RouteSession<CharactersEvent> | null; vehicle: RouteSession<VehiclesEvent> | null }>({ figure: null, vehicle: null });
  const figureSession = () => {
    if (!modelSessions.current.figure && models.figures) {
      modelSessions.current.figure = editorSessions().open('/cutout', models.figures) as RouteSession<CharactersEvent>;
    }
    return modelSessions.current.figure;
  };
  const vehicleSession = () => {
    if (!modelSessions.current.vehicle && models.vehicles) {
      modelSessions.current.vehicle = editorSessions().open('/cutout', models.vehicles) as RouteSession<VehiclesEvent>;
    }
    return modelSessions.current.vehicle;
  };
  useEffect(() => () => {
    modelSessions.current.figure?.close();
    modelSessions.current.vehicle?.close();
  }, []);

  // ── the working target (draft-restored on mount) ───────────────────────────
  const [work, setWork] = useState<Work>(restoreOrBlank);
  const workRef = useRef(work); workRef.current = work;
  const [status, setStatus] = useState(
    work.initial ? `restored working draft · ${work.name}` : 'blank canvas — paint, or load an image (drop a file anywhere)',
  );
  const [edited, setEdited] = useState(!!work.initial);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const painterApi = useRef<PainterApi | null>(null);

  // Smart-backend choice (the original's flood/SAM toggle; SAM wins by
  // default when the onnx host binding exists — the auto rule).
  const samAvailable = useMemo(() => PAINT.isSegmentAvailable(), []);
  const [backendChoice, setBackendChoice] = useRouteTwigState<BackendChoice>('/cutout', 'backendChoice', samAvailable ? 'sam' : 'flood');
  useEffect(() => {
    if (backendChoice === 'sam' && !samAvailable) setBackendChoice('flood');
  }, [backendChoice, samAvailable, setBackendChoice]);

  // Grayscale of the source (edge snap / refine) — loaded async per target.
  const [gray, setGray] = useState<GraySource | null>(null);
  useEffect(() => {
    setGray(null);
    const path = work.srcPath;
    if (!path) return;
    let stale = false;
    void loadGraySource(path, work.dims).then((g) => { if (!stale && g) setGray(g); });
    return () => { stale = true; };
  }, [work.srcPath, work.epoch]);

  // ── working-draft autosave (debounced; the in-between-saves lifeline) ──────
  // HOTDRAFT (MODELPAINT-0605): MODEL TARGETS DRAFT TOO — the draft carries
  // the binding, so a hot update mid-painting restores the same face/part
  // with the unsaved strokes intact and the next save still applies to the
  // MODEL (never silently retargeted at the library).
  // TATTOODRAFT: the lifeline is a BOOK — one slot PER TARGET, so hopping
  // between body parts mid-tattoo never drops the previous part's unsaved
  // strokes. flushDraft() writes synchronously before every target switch
  // (the debounce window must not eat the tail of the old target).
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writeDraftSlot = useCallback(() => {
    const doc = painterApi.current?.buildDocument() ?? null;
    if (!doc) return;
    const w = workRef.current;
    const draft = buildDraft({ docId: w.docId, name: w.name, srcPath: w.srcPath, textureId: w.textureId, model: w.model, doc });
    writeDraftBook(upsertDraftSlot(readDraftBook(), w.docId, draft, VIEW.draftSlots));
  }, []);
  const editedRef = useRef(false);
  editedRef.current = edited;
  const flushDraft = useCallback(() => {
    // only a target that was actually painted earns a slot — a pristine
    // open-and-leave must never evict someone's real unsaved work
    if (!draftTimer.current && !editedRef.current) return;
    if (draftTimer.current) { clearTimeout(draftTimer.current); draftTimer.current = null; }
    writeDraftSlot();
  }, [writeDraftSlot]);
  const onDirty = useCallback(() => {
    setEdited(true);
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      draftTimer.current = null;
      writeDraftSlot();
    }, VIEW.draftDebounceMs);
  }, [writeDraftSlot]);
  useEffect(() => () => { if (draftTimer.current) clearTimeout(draftTimer.current); }, []);

  // ── source actions ─────────────────────────────────────────────────────────
  const newCanvas = (wPx: number, hPx: number) => {
    flushDraft();
    const dims = { w: clampCanvasSize(wPx), h: clampCanvasSize(hPx) };
    setWork((prev) => freshWork(prev, { dims }));
    setEdited(false);
    setStatus(`new canvas · ${dims.w}×${dims.h}`);
    live.session?.note(`new canvas · ${dims.w}×${dims.h}`);
  };

  const loadImage = async (path: string) => {
    const clean = path.trim();
    if (!clean) return;
    flushDraft();
    setStatus(`reading ${clean}…`);
    const dims = await identifyImage(clean);
    if (!dims) { setStatus(`could not read image: ${clean}`); return; }
    const name = stemOf(clean);
    setWork((prev) => freshWork(prev, { name, srcPath: clean, dims }));
    setEdited(false);
    setStatus(`loaded ${name} · ${dims.w}×${dims.h}`);
    live.session?.note(`loaded image · ${name} · ${dims.w}×${dims.h}`);
  };
  const loadImageRef = useRef(loadImage);
  loadImageRef.current = loadImage;
  useFileDrop((path) => { void loadImageRef.current(path); });

  // ── library actions (commit-grade: content event + labeled marker) ────────
  const saveDocument = () => {
    if (!edited) { setStatus('nothing to save yet — paint something first'); return; }
    // a model target saves to its MODEL document, never the library
    if (work.model) { saveModelPaint(work.model); return; }
    const doc = painterApi.current?.buildDocument() ?? null;
    if (!doc || !live.session) { setStatus('nothing to save'); return; }
    const name = work.name.trim() || 'untitled';
    live.session.commit(
      { kind: 'saved', id: work.docId, name, srcPath: work.srcPath, textureId: work.textureId, doc },
      `save · ${name} · ${doc.dims.w}×${doc.dims.h} · ${doc.layers.length} layer${doc.layers.length === 1 ? '' : 's'}`,
    );
    setLibRev((r) => r + 1);
    setLastSavedAt(Date.now());
    setStatus(`saved ${name}`);
  };

  const extract = () => {
    if (!edited) { setStatus('nothing selected — paint or smart-select a region first'); return; }
    const mask = painterApi.current?.composeExportMask() ?? null;
    if (!mask || !live.session) { setStatus('nothing to extract'); return; }
    const taken = libraryCutouts(library).map((c) => c.name);
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
    live.session.commit(
      { kind: 'extracted', id: asset.id, asset },
      `cutout · ${asset.name} · ${asset.pixels}px`,
    );
    setLibRev((r) => r + 1);
    setLastSavedAt(Date.now());
    setStatus(`extracted ${asset.name} · ${asset.pixels}px`);
  };

  const openDocument = (rec: SavedPaintDoc) => {
    flushDraft();
    setWork((prev) => freshWork(prev, {
      docId: rec.id, name: rec.name, srcPath: rec.srcPath, textureId: rec.textureId ?? null,
      dims: rec.doc.dims, initial: rec.doc,
    }));
    setEdited(true);
    setStatus(`opened ${rec.name}`);
    live.session?.note(`open document · ${rec.name}`);
  };

  const openCutout = (asset: CutoutAsset) => {
    flushDraft();
    setWork((prev) => freshWork(prev, {
      name: asset.name, srcPath: asset.srcPath, textureId: asset.textureId ?? null,
      dims: asset.dims, initial: cutoutToDocument(asset),
    }));
    setEdited(true);
    setStatus(`opened cutout ${asset.name} as a new document`);
    live.session?.note(`open cutout · ${asset.name}`);
  };

  // ── MODEL TEXTURE TARGETS (MODELPAINT-0605) ────────────────────────────────
  // "i dont want to paint depth, i want to paint their face though, or body
  // parts" — pick a face/body part/vehicle part, paint pixels, save back onto
  // the model document through the doors.
  const openModelTarget = (binding: ModelBinding) => {
    flushDraft(); // the OLD target's unsaved strokes land in its book slot first
    const model: BodyDocument | VehicleDoc | undefined = binding.family === 'figure'
      ? models.figures?.state().characters[binding.docId]
      : models.vehicles?.state().vehicles[binding.docId];
    if (!model) { setStatus(`model ${binding.docId} not found`); return; }
    // TATTOODRAFT: this part's own unsaved slot wins over the saved overlay —
    // coming back to the torso mid-tattoo resumes exactly where you left it.
    // Empty slot docs are open-intent placeholders, not paintings.
    const slot = readDraftBook().slots[modelWorkId(binding)] ?? null;
    const slotDoc = slot && slotDocumentHasContent(slot.doc) ? slot.doc : null;
    const overlay = overlayOf(binding, (model as any).paint);
    const initial = slotDoc ?? (overlay ? reopenOverlayDocument(overlay) : null);
    setWork((prev) => freshWork(prev, {
      docId: modelWorkId(binding),
      name: modelWorkName(binding),
      model: binding,
      modelBg: modelCanvasBg(binding, model),
      modelLayers: binding.family === 'figure' && binding.part === 'head'
        ? (model as BodyDocument).parts.head.layers
        : null,
      dims: modelCanvasDims(binding),
      initial,
    }));
    setEdited(!!initial);
    setStatus(`painting ${binding.family} ${binding.docId} · ${binding.part}${slotDoc ? ' (unsaved draft resumed)' : initial ? ' (reopened)' : ''}`);
    live.session?.note(`paint model · ${binding.family} ${binding.docId} · ${binding.part}`);
    // OPEN-SLOT (the user's "took a torso to the cutout → a hot update hit →
    // it went away"): opening a model target is itself worth persisting —
    // record the slot NOW (the painting if any, else an open-intent
    // placeholder), so a hot update before the first stroke restores the
    // same target instead of whatever was current before.
    writeDraftBook(upsertDraftSlot(
      readDraftBook(),
      modelWorkId(binding),
      buildDraft({
        docId: modelWorkId(binding), name: modelWorkName(binding), srcPath: null,
        model: binding, doc: initial ?? emptyModelDocument(modelCanvasDims(binding)),
      }),
      VIEW.draftSlots,
    ));
  };

  // The deep-link mailbox: another route said "paint texture → /cutout with
  // the model preloaded" — take it once on mount and open the target.
  const openModelTargetRef = useRef(openModelTarget);
  openModelTargetRef.current = openModelTarget;
  useEffect(() => {
    const pending = takePendingModelTarget();
    if (pending) openModelTargetRef.current(pending);
  }, []);

  // Save a model painting: bake → apply through the door → ONE labeled
  // commit-grade upsert on the owning channel. An empty painting CLEARS the
  // slot (paint → unpaint is byte-parity, the door tests pin it).
  const saveModelPaint = (binding: ModelBinding) => {
    const doc = painterApi.current?.buildDocument() ?? null;
    if (!doc) { setStatus('nothing to save'); return; }
    const overlay = bakeOverlayFromDocument(doc, Date.now());
    const has = paintedOverlayHasContent(overlay);
    if (binding.family === 'figure') {
      const session = figureSession();
      const model = models.figures?.state().characters[binding.docId];
      if (!session || !model) { setStatus(`figure ${binding.docId} unavailable`); return; }
      const next = applyBodyPaint(model, binding.part as PaintTargetId, has ? overlay : null);
      session.commit({ kind: 'authored', id: binding.docId, doc: next },
        `${binding.docId}: ${binding.part} ${has ? 'painted' : 'paint cleared'}`);
    } else {
      const session = vehicleSession();
      const model = models.vehicles?.state().vehicles[binding.docId];
      if (!session || !model) { setStatus(`vehicle ${binding.docId} unavailable`); return; }
      const next = applyVehiclePaint(model, binding.part as VehiclePartId, has ? overlay : null);
      session.commit({ kind: 'authored', id: binding.docId, doc: next },
        `${binding.docId}: ${binding.part} ${has ? 'painted' : 'paint cleared'}`);
    }
    // the save landed on the model — its draft slot would now only shadow it
    // (and could resurrect stale strokes after an external edit): drop it
    if (draftTimer.current) { clearTimeout(draftTimer.current); draftTimer.current = null; }
    writeDraftBook(removeDraftSlot(readDraftBook(), modelWorkId(binding)));
    setEdited(false);
    setLibRev((r) => r + 1); // the MODELS rail re-reads painted dots
    setLastSavedAt(Date.now());
    setStatus(has
      ? `painted ${binding.part} saved to ${binding.docId}`
      : `cleared ${binding.part} paint on ${binding.docId}`);
  };

  // ── the material/shader lab connection ─────────────────────────────────────
  // IN: paint ON a registry texture — the material becomes the canvas under
  // the paint (1 tile, square canvas). Smart select needs an image FILE, so
  // it stays off here (like blank canvases); brush/lasso/layers all work.
  const paintOnMaterial = (id: string, label: string) => {
    flushDraft();
    const px = PAINT.tuning.canvas.defaultSize;
    setWork((prev) => freshWork(prev, { name: label, textureId: id, dims: { w: px, h: px } }));
    setEdited(false);
    setStatus(`painting on material · ${label}`);
    live.session?.note(`paint on material · ${label} (${id})`);
  };

  // OUT: Materialize an extracted cutout into a stored material through the
  // system's own door (saveCustomTexture + the 'cutout-stencil' recipe). The
  // record joins allTextures immediately — assignable in /textures, on
  // building faces, tiles, and parts.
  const materializeCutout = (asset: CutoutAsset) => {
    const record = saveCustomTexture(asset.name, STENCIL_RECIPE_ID, stencilDataFromAsset(asset));
    live.session?.note(`materialized · ${asset.name} → ${record.id}`);
    setStatus(`material saved · ${record.id} — assignable in /textures and on faces/tiles`);
  };

  // The browsable shared system: stored materials re-render on save/remove
  // (the studio's own subscription); recipes are the catalog at defaults.
  const customs = useCustomTextures();
  const shaderTextures = useMemo(
    () => allTextures().filter((t) => t.source.kind === 'shader'),
    [customs],
  );
  const storedMaterials = shaderTextures.filter((t) => t.id.startsWith('custom:'));
  const recipes = shaderTextures.filter((t) => !t.id.startsWith('custom:'));

  const removeEntry = (id: string, target: 'document' | 'cutout', name: string) => {
    if (!live.session) return;
    live.session.commit({ kind: 'removed', id, target }, `remove ${target} · ${name}`);
    setLibRev((r) => r + 1);
    setStatus(`removed ${name}`);
  };

  const documents = libraryDocuments(library);
  const cutouts = libraryCutouts(library);

  // the MODELS rail: rosters read live off the one store (libRev re-renders
  // after a model save so painted dots refresh)
  const [modelPick, setModelPick] = useRouteTwigState<{ family: 'figure' | 'vehicle'; docId: string } | null>('/cutout', 'modelPick', null);
  const figureRoster = models.figures ? models.figures.state() : null;
  const vehicleGarage = models.vehicles ? models.vehicles.state() : null;
  const modelCount = (figureRoster?.order.length ?? 0) + (vehicleGarage?.order.length ?? 0);

  return (
    <Col style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', backgroundColor: T.page }}>
      {/* ── header: exit · identity · save / extract · status ───────────────── */}
      <Row style={{
        height: VIEW.headerHeight, alignItems: 'center', gap: 8,
        paddingHorizontal: 10, backgroundColor: T.panelSolid,
        borderBottomWidth: 1, borderColor: T.frame,
      }}>
        <Chip label="← editor" color="dim" onPress={props.onExit} />
        <Text style={{ color: T.dim, fontSize: 10, fontWeight: '800', letterSpacing: 1 }}>CUTOUT PAINTER</Text>
        <Box style={{ width: 1, height: 18, backgroundColor: T.frame }} />
        <TextInput
          value={work.name}
          onChangeText={(t: string) => setWork((w) => ({ ...w, name: t }))}
          placeholder="name"
          style={{
            width: VIEW.nameWidth, height: 26, fontSize: 11, color: T.ink,
            backgroundColor: T.control, borderWidth: 1, borderColor: T.frame,
            borderRadius: 5, paddingHorizontal: 8,
          }}
        />
        <Chip label="save" color={edited ? 'good' : 'dim'} onPress={saveDocument} />
        <Chip label="extract cutout" color={edited ? 'accent' : 'dim'} onPress={extract} />
        <Box style={{ flexGrow: 1 }} />
        <Text style={{ color: T.dim, fontSize: 10 }} numberOfLines={1}>{status}</Text>
      </Row>

      {live.error ? (
        <Box style={{ padding: 8, backgroundColor: '#3a1320' }}>
          <Text style={{ color: T.bad, fontSize: 11 }}>
            {`library store unavailable — painting works, saves are off: ${live.error}`}
          </Text>
        </Box>
      ) : null}

      {/* ── body: library rail | the full painter app ───────────────────────── */}
      <Row style={{ flexGrow: 1, flexBasis: 0, minHeight: 0 }}>
        <Col style={{
          width: VIEW.railWidth, padding: 10, gap: 8,
          backgroundColor: T.panelSolid, borderRightWidth: 1, borderColor: T.frame,
        }}>
          <ScrollView style={{ flexGrow: 1 }}>
            <Col style={{ gap: 10 }}>
              {/* MODELPAINT-0605: THE place you paint model textures — pick a
                  face, a body part, or a vehicle part; save lands on the model. */}
              <LibrarySection title={`MODELS · ${modelCount}`}>
                {figureRoster?.order.map((id) => (
                  <ModelRow
                    key={`fig-${id}`}
                    label={id}
                    family="figure"
                    paint={(figureRoster.characters[id] as any)?.paint}
                    parts={FIGURE_PAINT_TARGETS}
                    partLabels={PAINT_TARGET_LABELS}
                    open={modelPick?.family === 'figure' && modelPick.docId === id}
                    activePart={work.model?.family === 'figure' && work.model.docId === id ? work.model.part : null}
                    onToggle={() => setModelPick((p) => (p?.family === 'figure' && p.docId === id ? null : { family: 'figure', docId: id }))}
                    onPart={(part) => openModelTarget({ family: 'figure', docId: id, part: part as PaintTargetId })}
                  />
                ))}
                {vehicleGarage?.order.map((id) => (
                  <ModelRow
                    key={`veh-${id}`}
                    label={id}
                    family="vehicle"
                    paint={(vehicleGarage.vehicles[id] as any)?.paint}
                    parts={VEHICLE_PART_IDS}
                    partLabels={null}
                    open={modelPick?.family === 'vehicle' && modelPick.docId === id}
                    activePart={work.model?.family === 'vehicle' && work.model.docId === id ? work.model.part : null}
                    onToggle={() => setModelPick((p) => (p?.family === 'vehicle' && p.docId === id ? null : { family: 'vehicle', docId: id }))}
                    onPart={(part) => openModelTarget({ family: 'vehicle', docId: id, part: part as VehiclePartId })}
                  />
                ))}
                {modelCount === 0 ? <RailHint text="author characters in /characters and vehicles in /vehicles — their textures paint here" /> : null}
              </LibrarySection>
              <LibrarySection title={`DOCUMENTS · ${documents.length}`}>
                {documents.map((rec) => (
                  <LibraryRow
                    key={rec.id}
                    active={rec.id === work.docId}
                    label={rec.name}
                    detail={`${rec.doc.dims.w}×${rec.doc.dims.h} · ${rec.doc.layers.length}L${rec.srcPath ? ' · img' : rec.textureId ? ' · mat' : ''}`}
                    onOpen={() => openDocument(rec)}
                    onRemove={() => removeEntry(rec.id, 'document', rec.name)}
                  />
                ))}
                {documents.length === 0 ? <RailHint text="save a painting to start the library" /> : null}
              </LibrarySection>
              <LibrarySection title={`CUTOUTS · ${cutouts.length}`}>
                {cutouts.map((asset) => (
                  <CutoutRow
                    key={asset.id}
                    asset={asset}
                    onOpen={() => openCutout(asset)}
                    onMaterialize={() => materializeCutout(asset)}
                    onRemove={() => removeEntry(asset.id, 'cutout', asset.name)}
                  />
                ))}
                {cutouts.length === 0 ? <RailHint text="select a region, then extract — →mat saves it as a material" /> : null}
              </LibrarySection>
              <LibrarySection title={`MATERIALS · ${storedMaterials.length}`}>
                {storedMaterials.map((def) => (
                  <MaterialRow
                    key={def.id}
                    id={def.id}
                    label={def.label}
                    active={def.id === work.textureId}
                    swatch={def.source.kind === 'shader' ? def.source : null}
                    onPress={() => paintOnMaterial(def.id, def.label)}
                  />
                ))}
                {storedMaterials.length === 0 ? <RailHint text="the studio's saved materials land here — paint on any of them" /> : null}
              </LibrarySection>
              <LibrarySection title={`RECIPES · ${recipes.length}`}>
                {recipes.map((def) => (
                  <MaterialRow
                    key={def.id}
                    id={def.id}
                    label={def.label}
                    active={def.id === work.textureId}
                    swatch={null}
                    onPress={() => paintOnMaterial(def.id, def.label)}
                  />
                ))}
              </LibrarySection>
            </Col>
          </ScrollView>
        </Col>

        {/* fresh painter per working target (key) — stack, textures, history */}
        <Workbench
          key={`${work.docId}#${work.epoch}`}
          work={work}
          activeModel={work.model
            ? (work.model.family === 'figure'
                ? figureRoster?.characters[work.model.docId] ?? null
                : vehicleGarage?.vehicles[work.model.docId] ?? null)
            : null}
          gray={gray}
          session={live.session}
          apiRef={painterApi}
          samAvailable={samAvailable}
          backendChoice={backendChoice}
          onBackendChoice={setBackendChoice}
          edited={edited}
          lastSavedAt={lastSavedAt}
          onDirty={onDirty}
          onNewCanvas={newCanvas}
          onLoadImage={(p) => { void loadImage(p); }}
        />
      </Row>
    </Col>
  );
}

// ── the painter mount: tool rail · viewport · inspector · status bar ─────────

function Workbench(props: {
  work: Work;
  /** the live model document under a model binding (re-read after saves) */
  activeModel: BodyDocument | VehicleDoc | null;
  gray: GraySource | null;
  session: PaintSession | null;
  apiRef: { current: PainterApi | null };
  samAvailable: boolean;
  backendChoice: BackendChoice;
  onBackendChoice: (b: BackendChoice) => void;
  edited: boolean;
  lastSavedAt: number | null;
  onDirty: () => void;
  onNewCanvas: (w: number, h: number) => void;
  onLoadImage: (path: string) => void;
}) {
  const { work } = props;
  // Smart select rides the chosen backend, only when an image source exists
  // (the blank-canvas guard is the painter's own smartAvailable rule).
  const backend = useMemo(() => {
    if (!work.srcPath) return null;
    return props.backendChoice === 'sam' && props.samAvailable
      ? PAINT.createSamBackend()
      : PAINT.createFloodBackend();
  }, [work.srcPath, props.backendChoice, props.samAvailable]);
  const s = usePaintEditor({
    idPrefix: 'cutout',
    dims: work.dims,
    srcPath: work.srcPath,
    gray: props.gray,
    backend,
    session: props.session,
    initial: work.initial,
  });
  const lookColors = () => {
    const i = s.activeLayer;
    const cfg = i >= 0 && i < s.layers.length ? s.layers[i].config : null;
    return (cfg?.colors ?? s.defaults.colors).slice();
  };
  props.apiRef.current = { buildDocument: s.buildDocument, composeExportMask: s.composeExportMask, lookColors };

  // The material canvas: the registry texture rendered UNDER the paint (the
  // PaintSurface underlay slot) — paint masks/shapes directly on the look.
  // The MODEL canvas (MODELPAINT-0605) rides the same slot: the part's base
  // (skin / body color) with the head's shape layers so face painting sees
  // the face it paints over.
  const underlay = useMemo(() => {
    if (work.model && work.modelBg) {
      return (
        <Box style={{ position: 'absolute', left: 0, top: 0, width: work.dims.w, height: work.dims.h, backgroundColor: work.modelBg, overflow: 'hidden' }}>
          {work.modelLayers ? <FaceLayerPaint layers={work.modelLayers} /> : null}
        </Box>
      );
    }
    if (!work.textureId) return undefined;
    const def = textureById(work.textureId);
    if (!def || def.source.kind !== 'shader') return undefined;
    return (
      <Effect
        shader={def.source.shader}
        data={def.source.data}
        style={{ position: 'absolute', left: 0, top: 0, width: work.dims.w, height: work.dims.h }}
      />
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work.model, work.modelBg, work.modelLayers, work.textureId, work.dims.w, work.dims.h]);

  // every meaningful edit → the route's edited flag + draft autosave
  const onDirtyRef = useRef(props.onDirty); onDirtyRef.current = props.onDirty;
  useEffect(() => {
    if (s.documentVersion > 0) onDirtyRef.current();
  }, [s.documentVersion]);

  const [fxModal, setFxModal] = useRouteTwigState('/cutout', 'fxModalOpen', false);

  return (
    <Col style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, minHeight: 0, position: 'relative' }}>
      <Row style={{ flexGrow: 1, flexBasis: 0, minHeight: 0 }}>
        <CutoutToolRail s={s} />
        <PaintSurface s={s} underlay={underlay} />
        {/* MODELPAINT-0605: the live 3D model — a PANEL in the right stack
            above the inspector (the user: the thin full-height column was
            bad; this is the layers/selection container language) */}
        {work.model ? (
          <Col style={{ height: '100%', minHeight: 0 }}>
            <ModelPreview3D
              s={s}
              binding={work.model}
              model={props.activeModel}
              bg={work.modelBg ?? '#808080'}
              modelLayers={work.modelLayers}
            />
            <Box style={{ flexGrow: 1, minHeight: 0, flexDirection: 'column' }}>
              <CutoutInspector
                s={s}
                samAvailable={props.samAvailable}
                backendChoice={props.backendChoice}
                onBackendChoice={props.onBackendChoice}
                srcPath={work.srcPath}
                textureId={work.textureId}
                edited={props.edited}
                lastSavedAt={props.lastSavedAt}
                onNewCanvas={props.onNewCanvas}
                onLoadImage={props.onLoadImage}
                onOpenEffectModal={() => setFxModal(true)}
                fill
              />
            </Box>
          </Col>
        ) : (
          <CutoutInspector
            s={s}
            samAvailable={props.samAvailable}
            backendChoice={props.backendChoice}
            onBackendChoice={props.onBackendChoice}
            srcPath={work.srcPath}
            textureId={work.textureId}
            edited={props.edited}
            lastSavedAt={props.lastSavedAt}
            onNewCanvas={props.onNewCanvas}
            onLoadImage={props.onLoadImage}
            onOpenEffectModal={() => setFxModal(true)}
          />
        )}
      </Row>
      <CutoutStatusBar s={s} edited={props.edited} lastSavedAt={props.lastSavedAt} />
      {/* custom-WGSL modal — last child of the workbench root (overlay rule) */}
      {fxModal ? <EffectModal s={s} onClose={() => setFxModal(false)} /> : null}
    </Col>
  );
}

// ── the custom-FX modal (name · WGSL editor · live/stale preview) ────────────

const CUSTOM_FX_TEMPLATE = `@group(0) @binding(1) var<storage, read> data: array<f32>;

fn maskAt(uv: vec2f) -> f32 {
  let gw = data[0];
  let gh = data[1];
  let igw = u32(gw);
  let igh = u32(gh);
  let xi = u32(floor(uv.x * gw));
  let yi = u32(floor(uv.y * gh));
  let cx = min(xi, igw - 1u);
  let cy = min(yi, igh - 1u);
  return data[8u + cy * igw + cx];
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let m = maskAt(in.uv);
  if (m < 0.5) { return vec4f(0.0); }

  let p = in.uv * 2.0 - vec2f(1.0);
  let r = length(p);
  let bands = 0.5 + 0.5 * sin(r * 24.0 - U.time * 3.0);
  let hue = fract(0.58 + bands * 0.18 + U.time * 0.04);
  let color = hsv2rgb(hue, 0.85, 1.0);
  return vec4f(color, data[2]);
}`;

const MODAL_PREVIEW_GRID = 18;
const MODAL_PREVIEW_CELLS = (() => {
  const cells = new Set<number>();
  for (let i = 0; i < MODAL_PREVIEW_GRID * MODAL_PREVIEW_GRID; i++) cells.add(i);
  return cells;
})();

function EffectModal({ s, onClose }: { s: ReturnType<typeof usePaintEditor>; onClose: () => void }) {
  const [label, setLabel] = useRouteTwigState('/cutout', 'fxDraftLabel', `Custom ${s.customSurfaces.length + 1}`);
  const [shader, setShader] = useRouteTwigState('/cutout', 'fxDraftShader', CUSTOM_FX_TEMPLATE);
  const [previewShader, setPreviewShader] = useRouteTwigState('/cutout', 'fxPreviewShader', CUSTOM_FX_TEMPLATE);
  const previewStale = shader !== previewShader;
  const add = () => {
    const id = s.addCustomSurface(label.trim() || 'Custom FX', shader);
    s.setLayerMode(s.activeLayer, id);
    onClose();
  };
  return (
    <Box style={{
      position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 90,
      backgroundColor: '#050812cc', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <Col style={{
        width: 760, height: 520, borderRadius: 10, overflow: 'hidden',
        backgroundColor: T.panelSolid, borderWidth: 1, borderColor: T.frame,
      }}>
        <Row style={{ height: 44, paddingHorizontal: 14, alignItems: 'center', gap: 10, borderBottomWidth: 1, borderColor: T.frame }}>
          <Text style={{ color: T.ink, fontSize: 12, fontWeight: '900' }}>New FX</Text>
          <Box style={{ flexGrow: 1 }} />
          <Text style={{ color: previewStale ? T.warn : T.dim, fontSize: 10, fontWeight: '800' }}>
            {previewStale ? 'preview stale' : 'preview live'}
          </Text>
        </Row>
        <Row style={{ flexGrow: 1, flexBasis: 0, minHeight: 0, padding: 14, gap: 12 }}>
          <Col style={{ width: 400, gap: 8, minHeight: 0 }}>
            <Text style={{ color: T.dim, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>NAME</Text>
            <TextInput
              value={label}
              onChangeText={setLabel}
              style={{
                height: 28, fontSize: 12, color: T.ink, backgroundColor: T.control,
                borderWidth: 1, borderColor: T.frame, borderRadius: 5, paddingHorizontal: 8,
              }}
            />
            <Text style={{ color: T.dim, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>SHADER (WGSL)</Text>
            <Box style={{
              flexGrow: 1, flexBasis: 0, minHeight: 0, borderRadius: 6,
              borderWidth: 1, borderColor: T.frame, backgroundColor: T.page, overflow: 'hidden',
            }}>
              <TextArea
                value={shader}
                onChangeText={setShader}
                fontSize={11}
                color={T.ink}
                style={{ flexGrow: 1, flexBasis: 0, minHeight: 0, padding: 10, color: T.ink, fontFamily: 'monospace' }}
              />
            </Box>
          </Col>
          <Col style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 8 }}>
            <Text style={{ color: T.dim, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>PREVIEW</Text>
            <Box style={{
              flexGrow: 1, flexBasis: 0, minHeight: 0, borderRadius: 6, position: 'relative',
              borderWidth: 1, borderColor: T.frame, backgroundColor: T.page, overflow: 'hidden',
            }}>
              <PaintQuad
                cells={MODAL_PREVIEW_CELLS}
                gridSize={MODAL_PREVIEW_GRID}
                worldW={300}
                worldH={400}
                dim={1}
                mode="custom:draft"
                customSurfaces={[{ id: 'custom:draft', label: 'draft', shader: previewShader }]}
              />
            </Box>
          </Col>
        </Row>
        <Row style={{ height: 48, paddingHorizontal: 14, alignItems: 'center', gap: 8, borderTopWidth: 1, borderColor: T.frame }}>
          <Text style={{ color: T.dim, fontSize: 10 }}>Apply preview to recompile · Add commits to the FX gallery</Text>
          <Box style={{ flexGrow: 1 }} />
          <Chip label="cancel" color="dim" onPress={onClose} />
          <Chip label="apply preview" color={previewStale ? 'warn' : 'dim'} onPress={() => setPreviewShader(shader)} />
          <Chip label="add" color="good" onPress={add} />
        </Row>
      </Col>
    </Box>
  );
}

// ── library rail pieces ───────────────────────────────────────────────────────

// (figure target labels come from the kit's PAINT_TARGET_LABELS — LIMBPAINT)

/** One model in the rail: header row toggles the part picker; a part chip
 *  opens that surface in the painter. ● marks already-painted parts. */
function ModelRow(props: {
  label: string;
  family: 'figure' | 'vehicle';
  paint: Record<string, unknown> | undefined;
  parts: readonly string[];
  partLabels: Record<string, string> | null;
  open: boolean;
  activePart: string | null;
  onToggle: () => void;
  onPart: (part: string) => void;
}) {
  const paintedCount = props.paint ? Object.keys(props.paint).length : 0;
  return (
    <Col style={{ gap: 4 }}>
      <Pressable onPress={props.onToggle}>
        <Row style={{
          gap: 6, alignItems: 'center', paddingHorizontal: 8, paddingVertical: 5,
          borderRadius: 5, borderWidth: 1,
          borderColor: props.open || props.activePart ? T.accent : T.frame,
          backgroundColor: props.open || props.activePart ? T.controlAlt : T.control,
        }}>
          <Col style={{ flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
            <Text style={{ color: props.open ? T.ink : T.dim, fontSize: 11 }} numberOfLines={1}>{props.label}</Text>
            <Text style={{ color: T.dim, fontSize: 9 }} numberOfLines={1}>
              {`${props.family}${paintedCount > 0 ? ` · ${paintedCount} painted` : ''}`}
            </Text>
          </Col>
          <Text style={{ color: T.dim, fontSize: 9, fontFamily: 'monospace' }}>{props.open ? '▾' : '▸'}</Text>
        </Row>
      </Pressable>
      {props.open ? (
        <Row style={{ gap: 4, flexWrap: 'wrap', paddingLeft: 4 }}>
          {props.parts.map((part) => (
            <Chip
              key={part}
              label={`${props.partLabels?.[part] ?? part}${props.paint && (props.paint as any)[part] ? ' ●' : ''}`}
              active={props.activePart === part}
              color="cyan"
              onPress={() => props.onPart(part)}
            />
          ))}
        </Row>
      ) : null}
    </Col>
  );
}

function LibrarySection(props: { title: string; children?: React.ReactNode }) {
  return (
    <Col style={{ gap: 5 }}>
      <Text style={{ color: T.dim, fontSize: 10, fontWeight: '800', letterSpacing: 1 }}>{props.title}</Text>
      {props.children}
    </Col>
  );
}

function RailHint(props: { text: string }) {
  return <Text style={{ color: T.dim, fontSize: 10 }}>{props.text}</Text>;
}

function LibraryRow(props: { active: boolean; label: string; detail: string; onOpen: () => void; onRemove: () => void }) {
  return (
    <Pressable onPress={props.onOpen}>
      <Row style={{
        gap: 6, alignItems: 'center', paddingHorizontal: 8, paddingVertical: 5,
        borderRadius: 5, borderWidth: 1,
        borderColor: props.active ? T.accent : T.frame,
        backgroundColor: props.active ? T.controlAlt : T.control,
      }}>
        <Col style={{ flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
          <Text style={{ color: props.active ? T.ink : T.dim, fontSize: 11 }} numberOfLines={1}>{props.label}</Text>
          <Text style={{ color: T.dim, fontSize: 9 }} numberOfLines={1}>{props.detail}</Text>
        </Col>
        <Pressable onPress={props.onRemove}>
          <Text style={{ color: T.bad, fontSize: 10, paddingHorizontal: 2 }}>✕</Text>
        </Pressable>
      </Row>
    </Pressable>
  );
}

function CutoutRow(props: { asset: CutoutAsset; onOpen: () => void; onMaterialize: () => void; onRemove: () => void }) {
  const { asset } = props;
  const cells = useMemo(() => previewCells(asset), [asset]);
  const tag = asset.srcPath ? ' · img' : asset.textureId ? ' · mat' : '';
  return (
    <Pressable onPress={props.onOpen}>
      <Row style={{
        gap: 8, alignItems: 'center', paddingHorizontal: 8, paddingVertical: 5,
        borderRadius: 5, borderWidth: 1, borderColor: T.frame, backgroundColor: T.control,
      }}>
        <Box style={{
          width: VIEW.swatch, height: VIEW.swatch, position: 'relative',
          backgroundColor: T.page, borderWidth: 1, borderColor: T.frame, borderRadius: 4,
          overflow: 'hidden',
        }}>
          <PaintQuad cells={cells} worldW={VIEW.swatch} worldH={VIEW.swatch} mode="solid" dim={0.9} />
        </Box>
        <Col style={{ flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
          <Text style={{ color: T.ink, fontSize: 11 }} numberOfLines={1}>{asset.name}</Text>
          <Text style={{ color: T.dim, fontSize: 9 }} numberOfLines={1}>
            {`${asset.dims.w}×${asset.dims.h} · ${asset.pixels}px${tag}`}
          </Text>
        </Col>
        <Pressable onPress={props.onMaterialize} tooltip="Materialize — save this shape as a stencil material (joins /textures)">
          <Text style={{ color: T.accent, fontSize: 9, fontWeight: '800', paddingHorizontal: 2 }}>→mat</Text>
        </Pressable>
        <Pressable onPress={props.onRemove}>
          <Text style={{ color: T.bad, fontSize: 10, paddingHorizontal: 2 }}>✕</Text>
        </Pressable>
      </Row>
    </Pressable>
  );
}

// A registry texture in the rail: stored materials show a live swatch; the
// (many) catalog recipes list as rows — pressing either makes it the canvas.
function MaterialRow(props: {
  id: string;
  label: string;
  active: boolean;
  swatch: { shader: string; data: number[] } | null;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={props.onPress} tooltip={`Paint on ${props.label} (${props.id})`}>
      <Row style={{
        gap: 8, alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4,
        borderRadius: 5, borderWidth: 1,
        borderColor: props.active ? T.accent : T.frame,
        backgroundColor: props.active ? T.controlAlt : T.control,
      }}>
        {props.swatch ? (
          <Box style={{
            width: VIEW.swatch, height: VIEW.swatch, position: 'relative',
            borderWidth: 1, borderColor: T.frame, borderRadius: 4, overflow: 'hidden',
          }}>
            <Effect shader={props.swatch.shader} data={props.swatch.data} style={{ position: 'absolute', left: 0, top: 0, width: VIEW.swatch, height: VIEW.swatch }} />
          </Box>
        ) : null}
        <Text style={{ color: props.active ? T.ink : T.dim, fontSize: 10 }} numberOfLines={1}>{props.label}</Text>
      </Row>
    </Pressable>
  );
}
