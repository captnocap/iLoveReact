// editors/workbench/characters/PaintLens.tsx — the PAINT lens (WBCHAR-0606
// parity rows J3, K1-K5; rebuilt under ONEPAINTER-0606).
//
// ONE PAINTER, ONE CHROME: this lens mounts the EXACT modules the /cutout
// surface mounts today — CutoutToolRail (with the ColorWheel), PaintSurface,
// CutoutInspector (tabbed TOOL · FX · SOURCE over the resizable LAYERS
// panel), CutoutStatusBar, ModelPreview3D — so a fix or feature in the
// painter lands in BOTH surfaces forever. The first cut mounted the generic
// PaintEditor kit instead (a second painter EXPERIENCE — the user's
// rejection, the ledger's own §8 review-blocker); that mount is DELETED.
// The only lens-owned surface is a thin SAVE strip (a host verb, layout not
// chrome — cutout's equivalent verb lives in its TopBar).
//
//   ┌──────┬───────────────────────┬──────────────┐
//   │ tool │  PaintSurface          │ live 3D      │  K4: the part re-bakes
//   │ rail │  (model underlay:      │ ModelPreview │  per stroke
//   │ +    │   part base + face     ├──────────────┤
//   │ wheel│   layers)              │ CutoutInspector (TOOL·FX·SOURCE
//   └──────┴───────────────────────┴──── + LAYERS) ┘
//      save strip (the lens's one verb) · CutoutStatusBar
//
// Save: bake → store.savePaintedModel (applyBodyPaint → ONE labeled commit
// on the characters channel; empty painting CLEARS — K3). Unsaved strokes
// ride the WORKBENCH-SCOPED slot book (K5 ruling: its own file, never
// cutout's) with the TATTOODRAFT resume law (K1).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Col, Row, Text } from '@reactjit/runtime/primitives';
import { readFile, writeFile } from '@reactjit/runtime/hooks/fs';
import { GAME_CHROME } from '../../../game/chrome';
import { paintedOverlayHasContent } from '../../../game/painted';
import { FaceLayerPaint } from '../../../game/figure/render';
import type { BodyDocument } from '../../../game/figure/body';
import type { PaintTargetId } from '../../../game/figure/shapes';
import { usePaintEditor, PaintSurface, PAINT, type PaintEditorState } from '../../paint';
import { readRouteTwigState } from '../../twigs';
import { CutoutToolRail } from '../../cutout/ToolRail';
import { CutoutInspector, type BackendChoice } from '../../cutout/Inspector';
import { CutoutStatusBar } from '../../cutout/StatusBar';
import {
  bakeOverlayFromDocument, emptyModelDocument, modelCanvasBg, modelCanvasDims,
  modelWorkId, modelWorkName, overlayOf, reopenOverlayDocument, slotDocumentHasContent,
  type ModelBinding,
} from '../../cutout/models';
import {
  buildDraft, emptyDraftBook, parseDraftBook, serializeDraftBook, upsertDraftSlot,
  type CutoutDraftBook,
} from '../../cutout/draft';
import { ModelPreview3D } from '../../cutout/ModelPreview';
import type { CharacterStore } from './store';

const { Chip } = GAME_CHROME;
const T = GAME_CHROME.tokens.color;

// K5: the workbench's OWN slot book — same pure book shape, different file.
const WB_PAINT_BOOK_PATH = 'cart/hmsc-int/sessions/_workbench_paint_drafts.json';
const WB_PAINT_SLOTS_CAP = 12;
const WB_DRAFT_DEBOUNCE_MS = 600;

function readBook(): CutoutDraftBook {
  try {
    const text = readFile(WB_PAINT_BOOK_PATH);
    return (text ? parseDraftBook(text) : null) ?? emptyDraftBook();
  } catch { return emptyDraftBook(); }
}
function writeBook(book: CutoutDraftBook): void {
  try { writeFile(WB_PAINT_BOOK_PATH, serializeDraftBook(book)); } catch { /* fs-less host */ }
}
function dropSlot(book: CutoutDraftBook, key: string): CutoutDraftBook {
  const slots = { ...book.slots };
  delete slots[key];
  return { ...book, order: book.order.filter((k) => k !== key), slots };
}

export function CharacterPaintLens(props: { store: CharacterStore }) {
  const s = props.store;
  const [, setTick] = useState(0);
  useEffect(() => s.subscribe(() => setTick((t) => t + 1)), [s]);

  // the route's own guard (Route.tsx:410), made gentler by the autosave
  if (!s.draftId) {
    return (
      <Col style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        <Text fontSize={12} color={T.dim}>PAINT works on the SAVED character</Text>
        <Text fontSize={10} color={T.dim}>make any edit (autosave mints a roster id) or press Save in the panel, then come back</Text>
      </Col>
    );
  }

  const binding: ModelBinding = { family: 'figure', docId: s.draftId, part: s.view.selPart as PaintTargetId };
  const model = (s.rosterState().characters[binding.docId] ?? null) as BodyDocument | null;
  if (!model) {
    return (
      <Col style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text fontSize={11} color={T.dim}>{`figure ${binding.docId} isn't on the roster yet — autosave lands it in a beat`}</Text>
      </Col>
    );
  }

  // TATTOODRAFT (K1): this part's unsaved slot wins over the saved overlay
  const workId = modelWorkId(binding);
  const slot = readBook().slots[workId] ?? null;
  const slotDoc = slot && slotDocumentHasContent(slot.doc) ? slot.doc : null;
  const overlay = overlayOf(binding, model.paint);
  const initial = slotDoc ?? (overlay ? reopenOverlayDocument(overlay) : null);

  // fresh painter per target (the cutout key law)
  return (
    <PaintTarget
      key={workId}
      store={s}
      binding={binding}
      model={model}
      workId={workId}
      initial={initial}
      resumed={!!slotDoc}
    />
  );
}

function PaintTarget(props: {
  store: CharacterStore;
  binding: ModelBinding;
  model: BodyDocument;
  workId: string;
  initial: ReturnType<typeof reopenOverlayDocument>;
  resumed: boolean;
}) {
  const { store, binding, model, workId } = props;
  const part = binding.part as PaintTargetId;
  const dims = modelCanvasDims(binding);
  const modelLayers = binding.family === 'figure' && binding.part === 'head' ? model.parts.head.layers : null;
  const bg = modelCanvasBg(binding, model);

  const s: PaintEditorState = usePaintEditor({
    idPrefix: 'wbchr-paint',
    dims,
    srcPath: null,
    gray: null,
    backend: null, // smart select needs an image FILE (the blank-canvas guard, cutout-identical)
    session: null, // the SAVE is the labeled commit (store.savePaintedModel)
    initial: props.initial,
  });

  // BRUSHTWIG-0606 (user: "hot updates change [brush sizes] on me"): the
  // painter twigs brushPx on /paint/<idPrefix>, but its document RESTORE
  // overwrites it from the doc's embedded value — and brush changes alone
  // never rewrite the slot doc, so every hot update reverted the size to the
  // last STROKE's brush. The twig carries the user's latest intent; re-assert
  // it once, after the painter's mount restore (this effect registers after
  // the hook's own, so it runs second).
  useEffect(() => {
    try {
      const remembered = readRouteTwigState('/paint/wbchr-paint', 'brushPx', s.brushPx);
      if (remembered !== s.brushPx) s.setBrushPx(remembered);
    } catch { /* twigless host */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once, post-restore
  }, []);

  // the same save-state surface cutout's chrome reads (edited pill, save age)
  const [edited, setEdited] = useState(!!props.initial);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  useEffect(() => { if (s.documentVersion > 0) setEdited(true); }, [s.documentVersion]);
  // the backend picker UI is the same; model targets never smart-select
  // (no source image), exactly like cutout's model targets
  const [backendChoice, setBackendChoice] = useState<BackendChoice>('flood');
  const samAvailable = useMemo(() => { try { return PAINT.isSegmentAvailable(); } catch { return false; } }, []);

  // the model canvas underlay: part base color + the head's face layers, so
  // face painting sees the face it paints over (cutout's K1 wire)
  const underlay = useMemo(() => (
    <Box style={{ position: 'absolute', left: 0, top: 0, width: dims.w, height: dims.h, backgroundColor: bg, overflow: 'hidden' }}>
      {modelLayers ? <FaceLayerPaint layers={modelLayers} /> : null}
    </Box>
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [bg, modelLayers, dims.w, dims.h]);

  // K5: debounced slot autosave into the WORKBENCH book (open-intent on
  // mount — a hot update before the first stroke restores this target)
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writeSlot = (doc = s.buildDocument()) => {
    writeBook(upsertDraftSlot(
      readBook(),
      workId,
      buildDraft({ docId: workId, name: modelWorkName(binding), srcPath: null, model: binding, doc: doc ?? emptyModelDocument(dims) }),
      WB_PAINT_SLOTS_CAP,
    ));
  };
  useEffect(() => { writeSlot(props.initial ?? emptyModelDocument(dims)); }, []);
  useEffect(() => {
    if (s.documentVersion <= 0) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => { draftTimer.current = null; writeSlot(); }, WB_DRAFT_DEBOUNCE_MS);
    return () => { if (draftTimer.current) clearTimeout(draftTimer.current); };
  }, [s.documentVersion]);

  // K3: bake → through the door → ONE labeled commit; empty painting CLEARS
  const save = () => {
    const doc = s.buildDocument();
    if (!doc) { store.setStatus('nothing to save'); return; }
    const baked = bakeOverlayFromDocument(doc, Date.now());
    const has = paintedOverlayHasContent(baked);
    store.savePaintedModel(part, has ? baked : null);
    if (draftTimer.current) { clearTimeout(draftTimer.current); draftTimer.current = null; }
    writeBook(dropSlot(readBook(), workId));
    setEdited(false);
    setLastSavedAt(Date.now());
  };

  return (
    <Col style={{ flexGrow: 1, minWidth: 0, minHeight: 0 }}>
      <Row style={{ flexGrow: 1, flexBasis: 0, minHeight: 0 }}>
        {/* the EXACT /cutout chrome — same modules, both surfaces, forever */}
        <CutoutToolRail s={s} />
        <PaintSurface s={s} underlay={underlay} />
        {/* the model-target stack, cutout's own arrangement (CutoutRoute:844-869):
            live 3D above the inspector (K4 — paint-and-see) */}
        <Col style={{ height: '100%', minHeight: 0 }}>
          <ModelPreview3D s={s} binding={binding} model={model} bg={bg} modelLayers={modelLayers} />
          <Box style={{ flexGrow: 1, minHeight: 0, flexDirection: 'column' }}>
            <CutoutInspector
              s={s}
              samAvailable={samAvailable}
              backendChoice={backendChoice}
              onBackendChoice={setBackendChoice}
              srcPath={null}
              textureId={null}
              edited={edited}
              lastSavedAt={lastSavedAt}
              onNewCanvas={() => store.setStatus('canvas documents live in /cutout — this lens paints the selected part')}
              onLoadImage={() => store.setStatus('image documents live in /cutout — this lens paints the selected part')}
              onOpenEffectModal={() => store.setStatus('custom WGSL FX opens in /cutout for now (its modal is route-local — ONEPAINTER-0606 report)')}
              fill
            />
          </Box>
        </Col>
      </Row>
      {/* the lens's ONE verb — a thin host strip (layout, never chrome) */}
      <Row style={{ alignItems: 'center', gap: 10, paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 4, backgroundColor: T.panelSolid, borderTopWidth: 1, borderColor: T.frame }}>
        <Text fontSize={10} color={T.dim} style={{ fontWeight: 800, letterSpacing: 1 }}>
          {`PAINTING ${binding.docId} · ${binding.part}${props.resumed ? ' · unsaved draft resumed' : ''}`}
        </Text>
        <Box style={{ flexGrow: 1 }} />
        <Chip label="save paint to character" color={edited ? 'good' : 'dim'} onPress={save} />
      </Row>
      <CutoutStatusBar s={s} edited={edited} lastSavedAt={lastSavedAt} />
    </Col>
  );
}
