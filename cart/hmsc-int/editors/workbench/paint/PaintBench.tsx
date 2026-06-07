// editors/workbench/paint/PaintBench.tsx — THE one painting surface
// (AGNOSTICPAINT-0606, parity row E1). The /cutout chrome, verbatim modules
// (ONEPAINTER-0606 law): CutoutToolRail (with the ColorWheel) · PaintSurface
// (model/material underlay) · ModelPreview3D above CutoutInspector for model
// targets · CutoutStatusBar — mounted over the agnostic bench store, so the
// SAME surface paints a shirt, a car door, a material, or a blank canvas.
// The character PAINT lens renders this exact component preloaded (§2 of the
// dispatch: one painting experience everywhere).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Col, Effect, Row, Text } from '@reactjit/runtime/primitives';
import { useFileDrop } from '@reactjit/runtime/hooks/useFileDrop';
import { GAME_CHROME } from '../../../game/chrome';
import { FaceLayerPaint } from '../../../game/figure/render';
import { textureById } from '../../../game/textures/registry';
import type { BodyDocument } from '../../../game/figure/body';
import { usePaintEditor, PaintSurface, PAINT, type PaintEditorState } from '../../paint';
// DEPTHOVERLAY-0606: the sculpt kit's depth-hint layer (figure targets) —
// the same grid truth the sculpt canvas shows, as a light contour underlay
import { DEPTH_HINT_WGSL, PAINT_EDITOR_TUNING, depthHintData, depthHintGrid } from '../../characters/paintKit';
import { editorTunables } from '../../tunables';
import { paintTargetPart, type PaintTargetId } from '../../../game/figure/shapes';
import { readRouteTwigState, useRouteTwigState } from '../../twigs';
import { CutoutToolRail, LinearRailSlider } from '../../cutout/ToolRail';
// IMGOPEN-0606: the original cutout app's ingest, restored — the picker
// (path cleaning happens inside the store's openImage, one door for all)
import { pickImageFile } from '../../cutout/sources';
import { CutoutInspector, type BackendChoice } from '../../cutout/Inspector';
import { CutoutStatusBar } from '../../cutout/StatusBar';
import { ModelPreview3D } from '../../cutout/ModelPreview';
// CUTOUTFLIP-0606: the custom-WGSL FX modal, extracted from the retired
// /cutout route — AGNOSTICPAINT deferral 2 closed, the FX button is live.
import { EffectModal } from './EffectModal';
import type { PaintBenchStore } from './store';

const { Chip } = GAME_CHROME;
const T = GAME_CHROME.tokens.color;

export function PaintBench(props: { store: PaintBenchStore }) {
  const store = props.store;
  const [, setTick] = useState(0);
  useEffect(() => store.subscribe(() => setTick((t) => t + 1)), [store]);
  // a fresh painter per working target (cutout's key law)
  return <BenchTarget key={`${store.work.docId}#${store.work.epoch}`} store={store} />;
}

function BenchTarget({ store }: { store: PaintBenchStore }) {
  const work = store.work;
  const model = work.model
    ? (work.model.family === 'figure'
        ? (store.figures()?.characters[work.model.docId] as BodyDocument | undefined) ?? null
        : (store.vehicles()?.vehicles[work.model.docId] ?? null))
    : null;

  // smart backend: the cutout rule — only with an image source; SAM gated
  const samAvailable = useMemo(() => { try { return PAINT.isSegmentAvailable(); } catch { return false; } }, []);
  const [backendChoice, setBackendChoice] = useRouteTwigState<BackendChoice>('/workbench', 'paintBackend', samAvailable ? 'sam' : 'flood');
  const backend = useMemo(() => {
    if (!work.srcPath) return null;
    return backendChoice === 'sam' && samAvailable ? PAINT.createSamBackend() : PAINT.createFloodBackend();
  }, [work.srcPath, backendChoice, samAvailable]);

  const s: PaintEditorState = usePaintEditor({
    idPrefix: 'wbchr-paint', // the pre-bench lens's prefix — the user's brush twigs carry
    dims: work.dims,
    srcPath: work.srcPath,
    gray: store.gray,
    backend,
    session: null, // saves are the labeled commits (the store's routing)
    initial: work.initial,
  });
  store.painterApi.current = {
    buildDocument: s.buildDocument,
    composeExportMask: s.composeExportMask,
    lookColors: () => {
      const i = s.activeLayer;
      const cfg = i >= 0 && i < s.layers.length ? s.layers[i].config : null;
      return (cfg?.colors ?? s.defaults.colors).slice();
    },
    addImageLayer: s.addImageLayer,
  };

  // BRUSHTWIG-0606 (carried): a restored document must not clobber the live
  // brush — re-assert the twig'd size once, after the painter's restore.
  useEffect(() => {
    try {
      const remembered = readRouteTwigState('/paint/wbchr-paint', 'brushPx', s.brushPx);
      if (remembered !== s.brushPx) s.setBrushPx(remembered);
    } catch { /* twigless host */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once, post-restore
  }, []);

  // every meaningful edit → the store's edited flag + draft-slot autosave.
  // DRAFTHOLE-0606: a restored document replays through applyDocument (one
  // version bump) — that is NOT the user's edit; dirty starts BEYOND the
  // restore baseline, so a fresh mount can never trigger a slot write that
  // races the painter's own rehydration.
  const dirtyRef = useRef(store.onDirty); dirtyRef.current = store.onDirty;
  const dirtyBase = store.work.initial ? 1 : 0;
  useEffect(() => { if (s.documentVersion > dirtyBase) dirtyRef.current(); }, [s.documentVersion, dirtyBase]);

  // anything dropped on the bench becomes the canvas (cutout's route-wide
  // drop) — openImage cleans file://-prefixed/quoted paths itself
  useFileDrop((path) => { void store.openImage(path); });

  // DEPTHOVERLAY-0606: the depth hint — default ON ("not blind"), twigged;
  // figure targets only (conditional-render law: it earns its space).
  // Intensity (USER req_0074) drives the P2 tunable THROUGH the registry —
  // the strip slider, /settings, and the shader read the one table.
  const [showDepthHint, setShowDepthHint] = useRouteTwigState<boolean>('/workbench', 'depthHint', true);
  const [, bumpHint] = useState(0);
  const hintOpacity = PAINT_EDITOR_TUNING.depthHint.opacity;
  const setHintOpacity = (v: number) => {
    editorTunables().write('sculpt-camera.depthHint.opacity', v);
    bumpHint((t) => t + 1);
  };
  // BENCHHINT-0606 (the live <BenchTarget> crash): a figure target is a
  // PAINT TARGET — a part OR a limb segment ('lUpperArm' …). The hint reads
  // part GRIDS, so a segment must resolve to ITS part first (the
  // ModelPreview FigurePartMesh precedent: one pipe sculpted once; the
  // painting is what's per-segment, not the mesh).
  const hintGrid = useMemo(
    () => (work.model?.family === 'figure' && model
      ? depthHintGrid(model as BodyDocument, paintTargetPart(work.model.part as PaintTargetId))
      : null),
    [model, work.model],
  );

  // the underlay: a model's base (+ the head's face layers) or the registry
  // material's live shader — the canvas IS the thing being painted (E1)
  const underlay = useMemo(() => {
    if (work.model && work.modelBg) {
      return (
        <Box style={{ position: 'absolute', left: 0, top: 0, width: work.dims.w, height: work.dims.h, backgroundColor: work.modelBg, overflow: 'hidden' }}>
          {work.modelLayers ? <FaceLayerPaint layers={work.modelLayers} /> : null}
          {/* the depth hint rides the underlay slot — it pans/zooms with the
              canvas; light contours, the sculpt canvas's color language */}
          {showDepthHint && hintGrid ? (
            <Effect
              shader={DEPTH_HINT_WGSL}
              data={depthHintData(hintGrid)}
              style={{ position: 'absolute', left: 0, top: 0, width: work.dims.w, height: work.dims.h }}
            />
          ) : null}
        </Box>
      );
    }
    if (!work.textureId) return undefined;
    const def: any = textureById(work.textureId);
    if (!def || def.source?.kind !== 'shader') return undefined;
    return (
      <Effect
        shader={def.source.shader}
        data={def.source.data}
        style={{ position: 'absolute', left: 0, top: 0, width: work.dims.w, height: work.dims.h }}
      />
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work.model, work.modelBg, work.modelLayers, work.textureId, work.dims.w, work.dims.h, showDepthHint, hintGrid, hintOpacity]);

  // CUTOUTFLIP-0606: the FX modal is the bench's own now — twig'd open
  // state, so a hot update mid-shader-edit reopens where you were.
  const [fxModal, setFxModal] = useRouteTwigState('/workbench', 'fxModalOpen', false);

  const inspector = (
    <CutoutInspector
      s={s}
      samAvailable={samAvailable}
      backendChoice={backendChoice}
      onBackendChoice={setBackendChoice}
      srcPath={work.srcPath}
      textureId={work.textureId}
      edited={store.edited}
      lastSavedAt={store.lastSavedAt}
      onNewCanvas={(w, h) => store.newCanvas(w, h)}
      onOpenEffectModal={() => setFxModal(true)}
      fill={!!work.model}
    />
  );

  const saveLabel = work.model
    ? `save to ${work.model.family} · ${work.model.part}`
    : 'save to library';

  return (
    <Col style={{ flexGrow: 1, minWidth: 0, minHeight: 0, position: 'relative' }}>
      <Row style={{ flexGrow: 1, flexBasis: 0, minHeight: 0 }}>
        <CutoutToolRail s={s} />
        <PaintSurface s={s} underlay={underlay} />
        {work.model && model ? (
          /* the model-target stack (cutout's own arrangement): live 3D above
             the inspector — paint-and-see (K4) */
          <Col style={{ height: '100%', minHeight: 0 }}>
            <ModelPreview3D s={s} binding={work.model} model={model} bg={work.modelBg ?? '#808080'} modelLayers={work.modelLayers} />
            <Box style={{ flexGrow: 1, minHeight: 0, flexDirection: 'column' }}>{inspector}</Box>
          </Col>
        ) : (
          inspector
        )}
      </Row>
      {/* the bench's verb strip — a host surface (cutout's header verbs) */}
      <Row style={{ alignItems: 'center', gap: 8, paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 4, backgroundColor: T.panelSolid, borderTopWidth: 1, borderColor: T.frame }}>
        <Text fontSize={10} color={T.dim} style={{ fontWeight: 800, letterSpacing: 1 }} numberOfLines={1}>
          {`${work.name.toUpperCase()}${work.resumed ? ' · unsaved draft resumed' : ''}`}
        </Text>
        <Box style={{ flexGrow: 1 }} />
        {store.sessionError ? <Text fontSize={10} color={T.bad} numberOfLines={1}>{`library store offline — ${store.sessionError}`}</Text> : null}
        {/* IMGOPEN-0606: the picker — no path typing, ever ("ya right. im
            not going to type a path xD"); dropping a file works too */}
        <Chip label="open image…" color="accent" onPress={() => { void pickImageFile().then((p) => { if (p) void store.openImage(p); }); }} />
        {/* DEPTHOVERLAY-0606 (+ req_0074): the hint toggle, and while it's
            on, its intensity — sliding the one P2 tunable */}
        {work.model?.family === 'figure' ? (
          <Chip label="depth hint" active={showDepthHint} color="cyan" onPress={() => setShowDepthHint(!showDepthHint)} />
        ) : null}
        {work.model?.family === 'figure' && showDepthHint ? (
          /* req_0074 intensity — THE kit slider (SCULPTKIT-0606 one-slider law) */
          <LinearRailSlider
            value={hintOpacity}
            min={0} max={1} step={0.05}
            onChange={setHintOpacity}
            format={(n) => `${Math.round(n * 100)}%`}
            tooltip="depth hint intensity — the same P2 dial as /settings"
          />
        ) : null}
        <Chip label={saveLabel} color={store.edited ? 'good' : 'dim'} onPress={store.saveCurrent} />
        <Chip label="extract cutout" color={store.edited ? 'accent' : 'dim'} onPress={store.extractCurrent} />
      </Row>
      <CutoutStatusBar s={s} edited={store.edited} lastSavedAt={store.lastSavedAt} />
      {/* custom-WGSL modal — last child of the bench root (overlay rule) */}
      {fxModal ? <EffectModal s={s} onClose={() => setFxModal(false)} /> : null}
    </Col>
  );
}
