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
import { readRouteTwigState, useRouteTwigState } from '../../twigs';
import { CutoutToolRail } from '../../cutout/ToolRail';
import { CutoutInspector, type BackendChoice } from '../../cutout/Inspector';
import { CutoutStatusBar } from '../../cutout/StatusBar';
import { ModelPreview3D } from '../../cutout/ModelPreview';
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

  // every meaningful edit → the store's edited flag + draft-slot autosave
  const dirtyRef = useRef(store.onDirty); dirtyRef.current = store.onDirty;
  useEffect(() => { if (s.documentVersion > 0) dirtyRef.current(); }, [s.documentVersion]);

  // anything dropped on the bench becomes the canvas (cutout's route-wide drop)
  useFileDrop((path) => { void store.openImage(path); });

  // the underlay: a model's base (+ the head's face layers) or the registry
  // material's live shader — the canvas IS the thing being painted (E1)
  const underlay = useMemo(() => {
    if (work.model && work.modelBg) {
      return (
        <Box style={{ position: 'absolute', left: 0, top: 0, width: work.dims.w, height: work.dims.h, backgroundColor: work.modelBg, overflow: 'hidden' }}>
          {work.modelLayers ? <FaceLayerPaint layers={work.modelLayers} /> : null}
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
  }, [work.model, work.modelBg, work.modelLayers, work.textureId, work.dims.w, work.dims.h]);

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
      onLoadImage={(p) => { void store.openImage(p); }}
      onOpenEffectModal={() => store.setStatus('custom WGSL FX opens in /cutout until the flip (its modal is route-local — AGNOSTICPAINT deferral 2)')}
      fill={!!work.model}
    />
  );

  const saveLabel = work.model
    ? `save to ${work.model.family} · ${work.model.part}`
    : 'save to library';

  return (
    <Col style={{ flexGrow: 1, minWidth: 0, minHeight: 0 }}>
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
        <Chip label={saveLabel} color={store.edited ? 'good' : 'dim'} onPress={store.saveCurrent} />
        <Chip label="extract cutout" color={store.edited ? 'accent' : 'dim'} onPress={store.extractCurrent} />
      </Row>
      <CutoutStatusBar s={s} edited={store.edited} lastSavedAt={store.lastSavedAt} />
    </Col>
  );
}
