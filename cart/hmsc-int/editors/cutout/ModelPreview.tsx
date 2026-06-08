// editors/cutout/ModelPreview.tsx — the LIVE 3D preview beside the canvas
// (MODELPAINT-0605, deliverable 3): "we will want to have a live 3d preview
// to see along side our paintings."
//
// The actual MODEL — the figure part for character textures, the whole
// vehicle for vehicle textures — with the IN-PROGRESS painting applied as
// you stroke. The trick is one offscreen StaticSurface (the LIVE capture):
// the model-canvas underlay + one PaintQuad per visible layer sampling the
// painter's OWN live GPU mask textures; the part mesh's textureKey points at
// it. Re-bakes are throttled (P2 knob): a frozen layer snapshot is taken at
// each bake tick, so the capture subtree's props change identity exactly
// then — the StaticSurface inline-prop rebake hazard, turned into the
// feature's clock.
//
// Camera: V23 native per-node orbit (GAME_NATIVE_CAMERA — the
// VehiclesRoute pattern). The host owns per-frame solve; drags send deltas;
// JS never drives the camera (V26).

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Image, Pressable, Scene3D, StaticSurface, Text } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import { GAME_CAMERA, GAME_CHROME, GAME_NATIVE_CAMERA, GAME_VEHICLE } from '@game';
import type { BodyDocument, VehicleDoc } from '@game';
import { VehiclePaintCaptures } from '../../game/paintedRender';
import { hedDepthGrid, HED_GRID_H, HED_GRID_W, type HedDocument, type HedLayer } from '../../game/figure/hed';
import { FaceLayerPaint } from '../../game/figure/render';
import { defaultProfile, paintTargetPart, PART_IDS, type PaintTargetId, type PartId } from '../../game/figure/shapes';
import { partsWithPelvisFallback } from '../../game/figure/body';
// the character editor's own mesh recipe (displaces EVERY part — the bake's
// partGlobeParams is head-only and rendered sculpted bodies as bare eggs)
import { editorPartParams } from '../characters/paintKit';
import { PaintQuad, type PaintEditorState } from '../paint';
import type { PaintLayer } from '../paint';
import { editorTunables } from '../tunables';
import { useRouteTwigState } from '../twigs';
import type { ModelBinding } from './models';

const T = GAME_CHROME.tokens.color;
const { Chip, Knob } = GAME_CHROME;

/** The one live texture key the previewed surface samples. */
export const MODEL_PREVIEW_LIVE_KEY = 'cutout.modelpaint.live';

// The preview's own numbers (P2 — registered where they live).
export const MODEL_PREVIEW = {
  bakeMs: 90,
  /** the preview is a PANEL in the right stack (the user: the full-height
   *  thin column was bad) — width matches the inspector, height is its own */
  panelWidth: 280,
  panelHeight: 300,
  figureDist: 3.2,
  vehicleDist: 8.2,
  fov: 42,
  yawPerPixel: 0.38,
  pitchPerPixel: 0.3,
};
editorTunables().register({
  system: 'cutout-modelpreview', route: '/cutout', table: MODEL_PREVIEW,
  specs: {
    bakeMs: { label: 'bake ms', min: 16, max: 1000, step: 8, precision: 0 },
    panelWidth: { label: 'panel w px', min: 220, max: 560, step: 10, precision: 0 },
    panelHeight: { label: 'panel h px', min: 180, max: 640, step: 10, precision: 0 },
    figureDist: { label: 'fig dist', min: 1, max: 10, step: 0.2, precision: 1 },
    vehicleDist: { label: 'veh dist', min: 3, max: 20, step: 0.2, precision: 1 },
    fov: { label: 'fov', min: 20, max: 90, step: 1, precision: 0 },
    yawPerPixel: { label: 'yaw/px', min: 0.05, max: 2, step: 0.01, precision: 2 },
    pitchPerPixel: { label: 'pitch/px', min: 0.05, max: 2, step: 0.01, precision: 2 },
  },
});

// ── the LIVE capture ──────────────────────────────────────────────────────────

/** Throttled bake clock: bumps at most once per bakeMs while the painter's
 *  mask/document versions move. */
function useBakeTick(version: number, bakeMs: number): number {
  const [tick, setTick] = useState(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef(0);
  useEffect(() => {
    const now = Date.now();
    const due = last.current + bakeMs;
    if (now >= due) {
      last.current = now;
      setTick((t) => t + 1);
      return;
    }
    if (pending.current) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      last.current = Date.now();
      setTick((t) => t + 1);
    }, due - now);
  }, [version, bakeMs]);
  useEffect(() => () => { if (pending.current) clearTimeout(pending.current); }, []);
  return tick;
}

/** The offscreen bake the mesh samples: underlay + live layer quads. memo'd
 *  so it re-renders (and the surface re-bakes) exactly at bake ticks. */
const LiveCapture = memo(function LiveCapture(props: {
  tick: number;
  layers: PaintLayer[];
  baseIdOf: (layer: PaintLayer) => string;
  brushIdOf: (layer: PaintLayer) => string;
  customSurfaces: PaintEditorState['customSurfaces'];
  w: number;
  h: number;
  bg: string;
  modelLayers: HedLayer[] | null;
}) {
  return (
    <StaticSurface
      staticKey={MODEL_PREVIEW_LIVE_KEY}
      style={{ position: 'absolute', left: -99999, top: 0, width: props.w, height: props.h }}
    >
      <Box style={{ width: props.w, height: props.h, backgroundColor: props.bg, position: 'relative', overflow: 'hidden' }}>
        {/* the bake clock: this zero-size node UPDATEs once per tick, which
            stamps the capture subtree dirty (the inline-prop rebake hazard,
            harnessed) — the layer quads keep stable keys, no Effect churn */}
        <Box style={{ width: 0, height: props.tick % 2 }} />
        {props.layers.map((layer) => (
          layer.config.muted ? null : [
            layer.image ? (
              <Image key={`live-img:${layer.id}`} source={layer.image.path} style={{ width: props.w, height: props.h }} />
            ) : null,
            <PaintQuad
              key={`live:${layer.id}`}
              paintableId={props.baseIdOf(layer)}
              overrideId={props.brushIdOf(layer)}
              worldW={props.w}
              worldH={props.h}
              mode={layer.config.mode}
              customSurfaces={props.customSurfaces}
              hueOffset={layer.config.hueOffset}
              phaseOffset={layer.config.phaseOffset}
              dim={layer.config.dim}
              colors={layer.config.colors}
              blend={layer.config.blend ?? 'normal'}
            />,
          ]
        ))}
        {props.modelLayers ? <FaceLayerPaint layers={props.modelLayers} /> : null}
      </Box>
    </StaticSurface>
  );
}, (a, b) => a.tick === b.tick && a.w === b.w && a.h === b.h && a.bg === b.bg && a.modelLayers === b.modelLayers);

// ── the meshes ────────────────────────────────────────────────────────────────

const vehicleGeometry = (kind: 'box' | 'cylinder' | 'sphere') =>
  kind === 'cylinder' ? Geometry.Cylinder : kind === 'sphere' ? Geometry.Sphere : Geometry.Box;

function FigurePartMesh(props: { model: BodyDocument; target: PaintTargetId }) {
  const { model, target } = props;
  // LIMBPAINT: a segment target previews on its PART's geometry (one pipe
  // sculpted once — the painting is what's per-segment, not the mesh)
  const part = paintTargetPart(target);
  const params = useMemo(() => {
    // THE SAME MODEL THE CHARACTER EDITOR SHOWS (the user's "its not the
    // same model" report): the bake recipe (partGlobeParams) displaces the
    // head ONLY, so a sculpted torso rendered as a bare egg here. Use the
    // editor's own recipe — editorPartParams displaces every part — fed
    // from the document: per-part sculpt grids, dragged outlines, and the
    // head's full sculpt+layers composite.
    const grid = HED_GRID_W * HED_GRID_H;
    // PELVISMESH-0606: stream documents bypass parseBody — normalize here so
    // a pre-split doc's pelvis previews as the torso copy it used to wear
    const parts = partsWithPelvisFallback(model.parts);
    const profiles = Object.fromEntries(
      PART_IDS.map((id) => [id, parts[id]?.profile ?? defaultProfile(id)]),
    ) as Record<PartId, number[]>;
    let displace: number[];
    if (part === 'head') {
      const hed: HedDocument = {
        kind: 'hed', version: 1, cols: HED_GRID_W, rows: HED_GRID_H,
        skin: model.skin, amount: model.amount, scaleY: model.headScaleY,
        sculpt: parts.head.sculpt, layers: parts.head.layers,
      };
      displace = hedDepthGrid(hed); // sculpt residue + layer relief, composited
    } else {
      const sculpt = parts[part]?.sculpt ?? [];
      displace = sculpt.length === grid ? sculpt.map((b) => b / 127) : new Array(grid).fill(0);
    }
    return editorPartParams(part, { amount: model.amount, headScaleY: model.headScaleY, profiles, footShape: model.footShape }, displace);
  }, [model, part]);
  return (
    <Scene3D.Mesh
      geometry={Geometry.Globe}
      params={params}
      // dyn-key contract "<slotId>~<version>" — versioned by the document's
      // own stamp so a re-authored sculpt re-uploads (the carve_lab lesson)
      dynamicKey={`cutout.preview.${part}~${model.metadata?.createdAt ?? 0}`}
      material="#ffffff"
      textureKey={MODEL_PREVIEW_LIVE_KEY}
      position={[0, 1.4, 0]}
    />
  );
}

function VehicleMeshesLive(props: { model: VehicleDoc; part: string }) {
  const build = useMemo(() => GAME_VEHICLE.build(props.model), [props.model]);
  return (
    <>
      {build.meshes.map((m, i) => (
        <Scene3D.Mesh
          key={`${m.id}.${i}`}
          geometry={vehicleGeometry(m.kind)}
          params={m.params}
          position={m.position}
          rotation={m.rotation ?? [0, 0, 0]}
          scale={m.scale}
          material={m.textureKey ? '#ffffff' : m.material}
          // the part being painted samples the LIVE capture; other painted
          // parts keep their saved keys (their captures mount below)
          textureKey={m.id === props.part && m.textureKey ? MODEL_PREVIEW_LIVE_KEY : m.textureKey}
        />
      ))}
    </>
  );
}

// (saved-overlay captures for the OTHER painted parts come from the shared
// VehiclePaintCaptures — game/paintedRender.tsx, the one source)

// ── the panel ─────────────────────────────────────────────────────────────────

export function ModelPreview3D(props: {
  s: PaintEditorState;
  binding: ModelBinding;
  model: BodyDocument | VehicleDoc | null;
  bg: string;
  modelLayers: HedLayer[] | null;
}) {
  const { s, binding } = props;

  // the throttled live bake (P2 knob) — a frozen layer snapshot per tick
  const tick = useBakeTick(s.maskVersion + s.documentVersion * 4096, MODEL_PREVIEW.bakeMs);
  const layersRef = useRef(s.layers);
  layersRef.current = s.layers;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- tick IS the clock
  const frozenLayers = useMemo(() => layersRef.current.slice(), [tick]);

  // ── V23 native orbit (the VehiclesRoute pattern) ───────────────────────────
  const isFigure = binding.family === 'figure';
  const target: [number, number, number] = isFigure ? [0, 1.4, 0] : [0, 0.8, 0];
  const [dist, setDist] = useRouteTwigState(
    '/cutout',
    isFigure ? 'modelPreviewFigureDist' : 'modelPreviewVehicleDist',
    isFigure ? MODEL_PREVIEW.figureDist : MODEL_PREVIEW.vehicleDist,
  );
  const lookRef = useRef({ yaw: 30, pitch: 16 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const cameraRef = useRef<any>(null);
  const camCtlRef = useRef<ReturnType<typeof GAME_NATIVE_CAMERA.forNode> | null>(null);
  useEffect(() => {
    const nodeId = Number(cameraRef.current?.id ?? 0);
    if (!nodeId) return;
    const ctl = GAME_NATIVE_CAMERA.forNode(nodeId);
    camCtlRef.current = ctl;
    ctl.setOrbit({ target, yaw: lookRef.current.yaw, pitch: lookRef.current.pitch, distance: dist, fov: MODEL_PREVIEW.fov, zoom: 1 });
    ctl.setMode('orbit');
    return () => { camCtlRef.current = null; ctl.disable(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- engage once; params ride the effect below
  }, []);
  useEffect(() => {
    const l = lookRef.current;
    camCtlRef.current?.setOrbit({ target, yaw: l.yaw, pitch: l.pitch, distance: dist, fov: MODEL_PREVIEW.fov, zoom: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dist]);
  const onDown = (e: any) => { dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0) }; };
  const onMove = (e: any) => {
    const d = dragRef.current;
    if (!d) return;
    const nx = Number(e?.x ?? 0), ny = Number(e?.y ?? 0);
    const dx = nx - d.x, dy = ny - d.y;
    d.x = nx; d.y = ny;
    const l = lookRef.current;
    // the pinned drag convention (V25): yaw DECREASES with a rightward drag
    const nextYaw = l.yaw - dx * MODEL_PREVIEW.yawPerPixel;
    const nextPitch = Math.max(4, Math.min(85, l.pitch - dy * MODEL_PREVIEW.pitchPerPixel));
    camCtlRef.current?.setInputDeltas(nextYaw - l.yaw, nextPitch - l.pitch);
    l.yaw = nextYaw;
    l.pitch = nextPitch;
  };
  const onUp = () => { dragRef.current = null; };
  const [bootCam] = useState(() =>
    GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, {
      target, yaw: lookRef.current.yaw, pitch: lookRef.current.pitch, dist, zoom: 1, fov: MODEL_PREVIEW.fov,
    }));

  if (!props.model) {
    return (
      <Box style={{ width: MODEL_PREVIEW.panelWidth, height: MODEL_PREVIEW.panelHeight, backgroundColor: T.panelSolid, padding: 10, borderLeftWidth: 1, borderBottomWidth: 1, borderColor: T.frame }}>
        <Text style={{ color: T.dim, fontSize: 11 }}>model unavailable</Text>
      </Box>
    );
  }

  return (
    // a PANEL in the right stack (above the inspector), not a column of its
    // own — the layers/selection container language
    <Pressable
      onMouseDown={onDown}
      onMouseMove={onMove}
      onMouseUp={onUp}
      style={{ width: MODEL_PREVIEW.panelWidth, height: MODEL_PREVIEW.panelHeight, position: 'relative', overflow: 'hidden', backgroundColor: T.panelSolid, borderLeftWidth: 1, borderBottomWidth: 1, borderColor: T.frame }}
    >
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={T.page}>
        <Scene3D.Camera nativeCamera ref={cameraRef} position={bootCam.pos} target={bootCam.target} fov={bootCam.fov} />
        <GAME_CHROME.LabEnvironment preset="studio" />
        {isFigure ? (
          <FigurePartMesh model={props.model as BodyDocument} target={binding.part as PaintTargetId} />
        ) : (
          <VehicleMeshesLive model={props.model as VehicleDoc} part={binding.part} />
        )}
      </Scene3D>
      {/* the live texture bake + the other parts' saved bakes */}
      <LiveCapture
        tick={tick}
        layers={frozenLayers}
        baseIdOf={s.baseIdOf}
        brushIdOf={s.brushIdOf}
        customSurfaces={s.customSurfaces}
        w={s.dims.w}
        h={s.dims.h}
        bg={props.bg}
        modelLayers={props.modelLayers}
      />
      {!isFigure ? <VehiclePaintCaptures doc={props.model as VehicleDoc} exceptPart={binding.part} /> : null}
      <Box style={{ position: 'absolute', left: 8, top: 8 }}>
        <Text style={{ color: T.dim, fontSize: 9, fontWeight: '800', letterSpacing: 1 }}>
          {`LIVE · ${binding.docId} · ${binding.part}`}
        </Text>
      </Box>
      <Box style={{ position: 'absolute', right: 10, bottom: 10 }}>
        <Knob
          label="zoom"
          value={dist}
          spec={{ min: isFigure ? 1 : 3, max: isFigure ? 10 : 20, step: 0.4, precision: 1 }}
          onChange={setDist}
        />
      </Box>
    </Pressable>
  );
}
