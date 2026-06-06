// editors/workbench/characters/PaintLens.tsx — the PAINT lens (WBCHAR-0606
// parity rows J3, K1-K5): texture painting on the selected part WITHOUT
// leaving the page — the /cutout model-target machinery mounted in-lens.
//
//   ┌──────────────────────────────┬──────────────┐
//   │  the shared painter           │ live 3D      │  K4 RULED DAY ONE:
//   │  (PaintEditor one-liner:      │ ModelPreview │  paint-and-see — the
//   │   rail · viewport · layers)   ├──────────────┤  part re-bakes per
//   │                               │ save panel   │  stroke (cutout's wire)
//   └──────────────────────────────┴──────────────┘
//
// ONE painter (editors/paint — no fork), ONE save door (store.savePainted-
// Model → applyBodyPaint → labeled commit on the characters channel, K3).
// Unsaved strokes ride a WORKBENCH-SCOPED slot book (K5 RULED: its own file,
// never cutout's — "makes it better if something gets really fucked up";
// one corrupted book must not eat both surfaces' unsaved work). The TATTOO-
// DRAFT law holds: an unsaved slot resumes over the saved overlay (K1).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Col, Row, Text } from '@reactjit/runtime/primitives';
import { readFile, writeFile } from '@reactjit/runtime/hooks/fs';
import { GAME_CHROME } from '../../../game/chrome';
import { paintedOverlayHasContent } from '../../../game/painted';
import { FaceLayerPaint } from '../../../game/figure/render';
import type { BodyDocument } from '../../../game/figure/body';
import type { PaintTargetId } from '../../../game/figure/shapes';
import { usePaintEditor, PaintEditor, type PaintEditorState } from '../../paint';
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
    backend: null, // smart select needs an image FILE (the blank-canvas guard)
    session: null, // the SAVE is the labeled commit (store.savePaintedModel)
    initial: props.initial,
  });

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
    const overlay = bakeOverlayFromDocument(doc, Date.now());
    const has = paintedOverlayHasContent(overlay);
    store.savePaintedModel(part, has ? overlay : null);
    // the save landed on the model — the slot would only shadow it now
    if (draftTimer.current) { clearTimeout(draftTimer.current); draftTimer.current = null; }
    writeBook(dropSlot(readBook(), workId));
  };

  return (
    <Row style={{ flexGrow: 1, minWidth: 0, minHeight: 0 }}>
      {/* ONE painter — rail · viewport · layers+look (K2) */}
      <PaintEditor s={s} />
      {/* K4 (RULED DAY ONE): the live 3D beside the painter — the part
          re-bakes per stroke; what you paint is what the figure wears */}
      <Col style={{ height: '100%', minHeight: 0 }}>
        <ModelPreview3D s={s} binding={binding} model={model} bg={bg} modelLayers={modelLayers} />
        <Col style={{ padding: 10, gap: 8, borderLeftWidth: 1, borderColor: T.frame, backgroundColor: T.panelSolid, flexGrow: 1 }}>
          <Text fontSize={10} color={T.dim} style={{ fontWeight: 800, letterSpacing: 1 }}>
            {`PAINTING ${binding.docId} · ${binding.part}${props.resumed ? ' · unsaved draft resumed' : ''}`}
          </Text>
          <Row style={{ gap: 8 }}>
            <Chip label="save paint to character" color="good" onPress={save} />
          </Row>
          <Text fontSize={10} color={T.dim}>
            an empty painting clears the part's paint · unsaved strokes ride the workbench draft book
          </Text>
        </Col>
      </Col>
    </Row>
  );
}
