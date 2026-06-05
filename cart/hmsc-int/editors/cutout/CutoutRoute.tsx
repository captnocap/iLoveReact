// editors/cutout/ — the CUTOUT PAINTER route (CUTOUTAPP-0605).
//
// The cutout APP EXPERIENCE remade as its own page in the one shell: the
// full-canvas, layer-stack, smart-select image/texture editor — for
// painting SKINS/TEXTURES, not the map. The engine is editors/paint/ (THE
// shared painter, consumed never forked); this route is the app around it:
// source ingestion (blank canvas / image file), the library of saved
// documents + extracted cutouts on the V20 'cutout' stream, and the
// route-scoped session history. cart/cutout is the behavior reference only
// (read, never imported, never edited — the user deletes it);
// editors/cutout/CAPTURE.md is the app-surface deletion contract.
//
// Session history (the user's ruling, V20): the route opens a SESSION on
// the 'cutout' channel. Strokes / lasso / smart clicks / layer ops land as
// labeled notes (the painter calls session.note per interaction); SAVES and
// EXTRACTIONS are commit-grade — the content event (full document / cutout
// asset) goes to the channel stream and the marker records its position.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Col, Pressable, Row, ScrollView, Text, TextInput } from '@reactjit/primitives';
import { useFileDrop } from '@reactjit/hooks/useFileDrop';
import { GAME_CHROME } from '@game';
import { editorChannel } from '../store';
import { editorSessions, type RouteSession } from '../sessions';
import {
  makeDefaultBackend, usePaintEditor, PaintEditor, PaintQuad, PAINT,
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

const { Chip } = GAME_CHROME;
const T = GAME_CHROME.tokens.color;

// The route's own view tuning (P2) — chrome sizes only, never paint behavior
// (paint behavior lives in editors/paint/tuning.ts).
const VIEW = Object.freeze({
  railWidth: 216,
  headerHeight: 46,
  swatch: 34,
  nameWidth: 130,
  dimWidth: 52,
  pathWidth: 240,
  presetSizes: [256, 512, 1024],
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

  // ── the working target ─────────────────────────────────────────────────────
  const [work, setWork] = useState<Work>(() => freshWork(null, {}));
  const [status, setStatus] = useState('blank canvas — paint, or load an image (drop a file anywhere)');
  const [wText, setWText] = useState(String(PAINT.tuning.canvas.defaultSize));
  const [hText, setHText] = useState(String(PAINT.tuning.canvas.defaultSize));
  const [pathText, setPathText] = useState('');
  const painterApi = useRef<PainterApi | null>(null);

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

  // ── source actions ─────────────────────────────────────────────────────────
  const newCanvas = () => {
    const dims = { w: clampCanvasSize(Number(wText)), h: clampCanvasSize(Number(hText)) };
    setWText(String(dims.w));
    setHText(String(dims.h));
    setWork((prev) => freshWork(prev, { dims }));
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
    setPathText(clean);
    setStatus(`loaded ${name} · ${dims.w}×${dims.h}`);
    live.session?.note(`loaded image · ${name} · ${dims.w}×${dims.h}`);
  };
  const loadImageRef = useRef(loadImage);
  loadImageRef.current = loadImage;
  useFileDrop((path) => { void loadImageRef.current(path); });

  // ── library actions (commit-grade: content event + labeled marker) ────────
  const saveDocument = () => {
    const doc = painterApi.current?.buildDocument() ?? null;
    if (!doc || !live.session) { setStatus('nothing to save'); return; }
    const name = work.name.trim() || 'untitled';
    live.session.commit(
      { kind: 'saved', id: work.docId, name, srcPath: work.srcPath, doc },
      `save · ${name} · ${doc.dims.w}×${doc.dims.h} · ${doc.layers.length} layer${doc.layers.length === 1 ? '' : 's'}`,
    );
    setLibRev((r) => r + 1);
    setStatus(`saved ${name}`);
  };

  const extract = () => {
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
    setStatus(`extracted ${asset.name} · ${asset.pixels}px`);
  };

  const openDocument = (rec: SavedPaintDoc) => {
    setWork((prev) => freshWork(prev, {
      docId: rec.id, name: rec.name, srcPath: rec.srcPath, dims: rec.doc.dims, initial: rec.doc,
    }));
    setStatus(`opened ${rec.name}`);
    live.session?.note(`open document · ${rec.name}`);
  };

  const openCutout = (asset: CutoutAsset) => {
    setWork((prev) => freshWork(prev, {
      name: asset.name, srcPath: asset.srcPath, dims: asset.dims, initial: cutoutToDocument(asset),
    }));
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
      {/* ── header: exit · identity · source controls · save/extract ───────── */}
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
        <Chip label="save" color="good" onPress={saveDocument} />
        <Chip label="extract cutout" color="accent" onPress={extract} />
        <Box style={{ width: 1, height: 18, backgroundColor: T.frame }} />
        <TextInput
          value={wText}
          onChangeText={setWText}
          style={{ width: VIEW.dimWidth, height: 26, fontSize: 11, color: T.ink, backgroundColor: T.control, borderWidth: 1, borderColor: T.frame, borderRadius: 5, paddingHorizontal: 6 }}
        />
        <Text style={{ color: T.dim, fontSize: 10 }}>×</Text>
        <TextInput
          value={hText}
          onChangeText={setHText}
          style={{ width: VIEW.dimWidth, height: 26, fontSize: 11, color: T.ink, backgroundColor: T.control, borderWidth: 1, borderColor: T.frame, borderRadius: 5, paddingHorizontal: 6 }}
        />
        {VIEW.presetSizes.map((px) => (
          <Chip key={px} label={`${px}`} color="dim" onPress={() => { setWText(String(px)); setHText(String(px)); }} />
        ))}
        <Chip label="new canvas" color="warn" onPress={newCanvas} />
        <Box style={{ width: 1, height: 18, backgroundColor: T.frame }} />
        <TextInput
          value={pathText}
          onChangeText={setPathText}
          placeholder="/path/to/image.png — or drop a file"
          style={{ width: VIEW.pathWidth, height: 26, fontSize: 11, color: T.ink, backgroundColor: T.control, borderWidth: 1, borderColor: T.frame, borderRadius: 5, paddingHorizontal: 8 }}
        />
        <Chip label="load" color="cyan" onPress={() => { void loadImage(pathText); }} />
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

      {/* ── body: library rail | the full painter ───────────────────────────── */}
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
        />
      </Row>
    </Col>
  );
}

// ── the painter mount ─────────────────────────────────────────────────────────

function Workbench(props: {
  work: Work;
  gray: GraySource | null;
  session: PaintSession | null;
  apiRef: { current: PainterApi | null };
}) {
  const { work } = props;
  // Smart select rides the best available backend, only when an image source
  // exists (the blank-canvas guard is the painter's own smartAvailable rule).
  const backend = useMemo(() => (work.srcPath ? makeDefaultBackend() : null), [work.srcPath]);
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
  return <PaintEditor s={s} />;
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
