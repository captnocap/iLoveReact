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
import { Box, Col, Pressable, Row, ScrollView, Text, TextArea, TextInput } from '@reactjit/primitives';
import { useFileDrop } from '@reactjit/hooks/useFileDrop';
import { exists, mkdir, readFile, writeFile } from '@reactjit/hooks/fs';
import { GAME_CHROME } from '@game';
import { editorChannel } from '../store';
import { editorSessions, type RouteSession } from '../sessions';
import {
  PAINT, usePaintEditor, PaintToolRail, PaintSurface, PaintQuad,
  type Dims, type GraySource, type PaintDocument, type PaintSession,
} from '../paint';
import {
  cutoutStream, libraryCutouts, libraryDocuments,
  type CutoutAsset, type CutoutEvent, type SavedPaintDoc,
} from './stream';
import {
  cutoutToDocument, extractCutout, mintDocumentId, previewCells, uniqueAssetName,
} from './extraction';
import { identifyImage, loadGraySource } from './sources';
import { buildDraft, CUTOUT_DRAFT_PATH, parseDraft, serializeDraft } from './draft';
import { CutoutInspector, type BackendChoice } from './Inspector';
import { CutoutStatusBar } from './StatusBar';

const { Chip } = GAME_CHROME;
const T = GAME_CHROME.tokens.color;

// The route's own view tuning (P2) — chrome sizes only, never paint behavior
// (paint behavior lives in editors/paint/tuning.ts).
const VIEW = Object.freeze({
  railWidth: 216,
  toolRailWidth: 190,
  headerHeight: 46,
  swatch: 34,
  nameWidth: 150,
  draftDebounceMs: 600,
  sessionsDir: 'cart/hmsc-int/sessions',
} as const);

/** One working target: what's on the canvas right now. A fresh `docId` is a
 *  new library entry; reopening a saved document keeps its id so re-saves
 *  upsert. `epoch` remounts the painter (fresh stack + textures). */
type Work = {
  docId: string;
  name: string;
  srcPath: string | null;
  dims: Dims;
  initial: PaintDocument | null;
  epoch: number;
};

/** What the header actions need from the live painter (lifted via ref — the
 *  paintApiRef idiom, so Save/Extract live in the one header). */
type PainterApi = {
  buildDocument: () => PaintDocument | null;
  composeExportMask: () => Uint8Array | null;
};

function freshWork(prev: Work | null, patch: Partial<Omit<Work, 'epoch'>>): Work {
  return {
    docId: patch.docId ?? mintDocumentId(),
    name: patch.name ?? 'untitled',
    srcPath: patch.srcPath ?? null,
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
 *  keeps the painted layers and drops the missing image. */
function restoreOrBlank(): Work {
  const text = readFile(CUTOUT_DRAFT_PATH);
  const draft = text ? parseDraft(text) : null;
  if (!draft) return { ...freshWork(null, {}), epoch: 0 };
  const srcOk = draft.srcPath ? exists(draft.srcPath) : true;
  return {
    docId: draft.docId,
    name: draft.name,
    srcPath: srcOk ? draft.srcPath : null,
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
  const [backendChoice, setBackendChoice] = useState<BackendChoice>(samAvailable ? 'sam' : 'flood');

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
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDirty = useCallback(() => {
    setEdited(true);
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      draftTimer.current = null;
      const doc = painterApi.current?.buildDocument() ?? null;
      if (!doc) return;
      const w = workRef.current;
      mkdir(VIEW.sessionsDir);
      writeFile(CUTOUT_DRAFT_PATH, serializeDraft(buildDraft({ docId: w.docId, name: w.name, srcPath: w.srcPath, doc })));
    }, VIEW.draftDebounceMs);
  }, []);
  useEffect(() => () => { if (draftTimer.current) clearTimeout(draftTimer.current); }, []);

  // ── source actions ─────────────────────────────────────────────────────────
  const newCanvas = (wPx: number, hPx: number) => {
    const dims = { w: clampCanvasSize(wPx), h: clampCanvasSize(hPx) };
    setWork((prev) => freshWork(prev, { dims }));
    setEdited(false);
    setStatus(`new canvas · ${dims.w}×${dims.h}`);
    live.session?.note(`new canvas · ${dims.w}×${dims.h}`);
  };

  const loadImage = async (path: string) => {
    const clean = path.trim();
    if (!clean) return;
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
    const doc = painterApi.current?.buildDocument() ?? null;
    if (!doc || !live.session) { setStatus('nothing to save'); return; }
    const name = work.name.trim() || 'untitled';
    live.session.commit(
      { kind: 'saved', id: work.docId, name, srcPath: work.srcPath, doc },
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
    setWork((prev) => freshWork(prev, {
      docId: rec.id, name: rec.name, srcPath: rec.srcPath, dims: rec.doc.dims, initial: rec.doc,
    }));
    setEdited(true);
    setStatus(`opened ${rec.name}`);
    live.session?.note(`open document · ${rec.name}`);
  };

  const openCutout = (asset: CutoutAsset) => {
    setWork((prev) => freshWork(prev, {
      name: asset.name, srcPath: asset.srcPath, dims: asset.dims, initial: cutoutToDocument(asset),
    }));
    setEdited(true);
    setStatus(`opened cutout ${asset.name} as a new document`);
    live.session?.note(`open cutout · ${asset.name}`);
  };

  const removeEntry = (id: string, target: 'document' | 'cutout', name: string) => {
    if (!live.session) return;
    live.session.commit({ kind: 'removed', id, target }, `remove ${target} · ${name}`);
    setLibRev((r) => r + 1);
    setStatus(`removed ${name}`);
  };

  const documents = libraryDocuments(library);
  const cutouts = libraryCutouts(library);

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
              <LibrarySection title={`DOCUMENTS · ${documents.length}`}>
                {documents.map((rec) => (
                  <LibraryRow
                    key={rec.id}
                    active={rec.id === work.docId}
                    label={rec.name}
                    detail={`${rec.doc.dims.w}×${rec.doc.dims.h} · ${rec.doc.layers.length}L${rec.srcPath ? ' · img' : ''}`}
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
                    onRemove={() => removeEntry(asset.id, 'cutout', asset.name)}
                  />
                ))}
                {cutouts.length === 0 ? <RailHint text="select a region, then extract" /> : null}
              </LibrarySection>
            </Col>
          </ScrollView>
        </Col>

        {/* fresh painter per working target (key) — stack, textures, history */}
        <Workbench
          key={`${work.docId}#${work.epoch}`}
          work={work}
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
  props.apiRef.current = { buildDocument: s.buildDocument, composeExportMask: s.composeExportMask };

  // every meaningful edit → the route's edited flag + draft autosave
  const onDirtyRef = useRef(props.onDirty); onDirtyRef.current = props.onDirty;
  useEffect(() => {
    if (s.documentVersion > 0) onDirtyRef.current();
  }, [s.documentVersion]);

  const [fxModal, setFxModal] = useState(false);

  return (
    <Col style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, minHeight: 0, position: 'relative' }}>
      <Row style={{ flexGrow: 1, flexBasis: 0, minHeight: 0 }}>
        <Col style={{
          width: VIEW.toolRailWidth, padding: 10,
          backgroundColor: T.panelSolid, borderRightWidth: 1, borderColor: T.frame,
        }}>
          <ScrollView style={{ flexGrow: 1 }}>
            <PaintToolRail s={s} />
          </ScrollView>
        </Col>
        <PaintSurface s={s} />
        <CutoutInspector
          s={s}
          samAvailable={props.samAvailable}
          backendChoice={props.backendChoice}
          onBackendChoice={props.onBackendChoice}
          srcPath={work.srcPath}
          edited={props.edited}
          lastSavedAt={props.lastSavedAt}
          onNewCanvas={props.onNewCanvas}
          onLoadImage={props.onLoadImage}
          onOpenEffectModal={() => setFxModal(true)}
        />
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
  const [label, setLabel] = useState(`Custom ${s.customSurfaces.length + 1}`);
  const [shader, setShader] = useState(CUSTOM_FX_TEMPLATE);
  const [previewShader, setPreviewShader] = useState(CUSTOM_FX_TEMPLATE);
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

function CutoutRow(props: { asset: CutoutAsset; onOpen: () => void; onRemove: () => void }) {
  const { asset } = props;
  const cells = useMemo(() => previewCells(asset), [asset]);
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
            {`${asset.dims.w}×${asset.dims.h} · ${asset.pixels}px${asset.srcPath ? ' · img' : ''}`}
          </Text>
        </Col>
        <Pressable onPress={props.onRemove}>
          <Text style={{ color: T.bad, fontSize: 10, paddingHorizontal: 2 }}>✕</Text>
        </Pressable>
      </Row>
    </Pressable>
  );
}
