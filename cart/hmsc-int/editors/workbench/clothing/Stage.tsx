// editors/workbench/clothing/Stage.tsx — the GARMENT stage (CLOTHSOURCE-0606,
// respec CLOTHFLIP-0607).
//
// Column 4 DEMONSTRATES (LAW 1): the garment ALONE — no body — rendered live
// from the store's selected variant (garmentRender: buildClothing's own
// placement, sliced by slot), over THE stage kit's studio environment (the
// same LabEnvironment every character stage mounts — the near-black-blob
// verdict's cure), framed to fill the stage. Below it, the VARIANT GRID:
// every variant as a VISUAL swatch — the print artwork / painted design /
// material itself, visible (the ruled spec: "designs are visual things") —
// click to select. The only stage inputs are that selection and the orbit
// camera (twig-persisted look, TWIGSTATE '/garment' keys); properties never
// get edited here.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Effect, Pressable, ScrollView, Scene3D, Text } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import { GAME_CAMERA, type Solved } from '../../../game/camera';
import { GAME_CHROME } from '../../../game/chrome';
import { GAME_NATIVE_CAMERA } from '../../../game/nativeCamera';
import { TextureCapture, textureById } from '../../../game/textures/registry';
import { PaintedOverlayPaint, PaintedOverlaySurface } from '../../../game/paintedRender';
import type { ClothingInstance } from '../../../game/figure/clothing';
import { CLOTHING } from '../../../game/figure/shapes';
import { ClothingSkinCaptures, ClothingSkinSurface } from '../../characters/preview';
import { readRouteTwigState, writeRouteTwigState } from '../../twigs';
import { accentFor } from '../../../shell/workbench.cls';
import { garmentRender } from './panel';
import type { ClothingStore, GarmentVariant } from './store';

const { LabEnvironment } = GAME_CHROME;

type Vec3 = [number, number, number];
type Rect = { x: number; y: number; width: number; height: number };

const NEUTRAL_PERCEPTION = { high: 0 } as any;
const TEX_PX = 256;
// swatch size — big enough that the print's own text reads (the grid shows
// the DESIGN, not a name chip)
const SWATCH_W = 104;
const SWATCH_H = 78;

const TWIG_ROUTE = '/garment';
type CamTwig = { yaw: number; pitch: number; dist: number | null };

function readCamTwig(): CamTwig {
  try { return readRouteTwigState(TWIG_ROUTE, 'camera', { yaw: 28, pitch: 14, dist: null } as CamTwig); } catch { return { yaw: 28, pitch: 14, dist: null }; }
}

function writeCamTwig(t: CamTwig): void {
  try { writeRouteTwigState(TWIG_ROUTE, 'camera', t); } catch { /* twigless host */ }
}

function clamp(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, n)); }

// the clothing-mesh idiom (editors/characters/preview.tsx:35) — textureKey'd
// instances paint white so the sampled print/material reads true
const clothingGeometry = (kind: ClothingInstance['geometry']) =>
  kind === 'sphere' ? Geometry.Sphere : kind === 'cone' ? Geometry.Cone : kind === 'cylinder' ? Geometry.Cylinder : Geometry.Box;

/** frame the garment to FILL the stage: instance-position bounds + margin */
function frameOf(instances: ClothingInstance[]): { target: Vec3; dist: number } {
  if (instances.length === 0) return { target: [0, 1.1, 0], dist: 2.4 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const inst of instances) {
    minX = Math.min(minX, inst.position[0]); maxX = Math.max(maxX, inst.position[0]);
    minY = Math.min(minY, inst.position[1]); maxY = Math.max(maxY, inst.position[1]);
    minZ = Math.min(minZ, inst.position[2]); maxZ = Math.max(maxZ, inst.position[2]);
  }
  const radius = Math.max(maxX - minX, maxY - minY, maxZ - minZ) / 2 + 0.35;
  return {
    target: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    dist: Math.max(1.2, radius * 2.3),
  };
}

/** one grid cell — the variant's LOOK, visible (print artwork, painted
 *  design, material), with its name underneath and a selected ring */
function VariantSwatch(props: { v: GarmentVariant; plainColor: string; selected: boolean; onPick(): void }) {
  const { v } = props;
  let face: any = null;
  if (v.seed) {
    face = v.skin === 'plain'
      ? <Box style={{ width: '100%', height: '100%', backgroundColor: props.plainColor }} />
      : <ClothingSkinSurface skin={v.skin} />;
  } else if ('design' in v) {
    face = (
      <Box style={{ width: '100%', height: '100%', backgroundColor: '#ffffff', position: 'relative', overflow: 'hidden' }}>
        <PaintedOverlayPaint overlay={v.design} w={SWATCH_W} h={SWATCH_H} />
      </Box>
    );
  } else {
    const def = textureById(v.textureId);
    face = def?.source.kind === 'shader'
      ? <Effect shader={def.source.shader} data={def.source.data} style={{ width: SWATCH_W, height: SWATCH_H }} />
      : <Box style={{ width: '100%', height: '100%', backgroundColor: accentFor('controlBg'), alignItems: 'center', justifyContent: 'center' }}>
          <Text fontSize={9} color={accentFor('textDim')}>{v.label}</Text>
        </Box>;
  }
  return (
    <Pressable onPress={props.onPick} style={{ flexDirection: 'column', alignItems: 'center', gap: 3 }}>
      <Box style={{
        width: SWATCH_W, height: SWATCH_H, overflow: 'hidden', borderRadius: 4,
        borderWidth: props.selected ? 2 : 1,
        borderColor: props.selected ? accentFor('primary') : accentFor('controlBorder'),
      }}>
        {face}
      </Box>
      <Text fontSize={9} color={props.selected ? accentFor('primary') : accentFor('textDim')} numberOfLines={1} style={{ maxWidth: SWATCH_W }}>
        {v.label}
      </Text>
    </Pressable>
  );
}

export function GarmentStage(props: { store: ClothingStore; garmentId: string }) {
  const { store, garmentId } = props;
  const r = garmentRender(store, garmentId);

  // ── the buildings stage's native-orbit wire + the '/garment' camera twig ──
  const [bootTwig] = useState(readCamTwig);
  const lookRef = useRef({ yaw: bootTwig.yaw, pitch: bootTwig.pitch });
  const distRef = useRef(bootTwig.dist ?? 2.4);
  const bootedRef = useRef(false);
  const cameraRef = useRef<any>(null);
  const ctlRef = useRef<ReturnType<typeof GAME_NATIVE_CAMERA.forNode> | null>(null);
  const rectRef = useRef<Rect>({ x: 0, y: 0, width: 800, height: 600 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const frame = useMemo(
    () => frameOf(r.instances),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- frame follows the garment, not per-variant identity
    [garmentId, r.instances.length],
  );
  if (!bootedRef.current && bootTwig.dist === null) distRef.current = frame.dist;

  const solveShadow = (): Solved =>
    GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, {
      target: frame.target, yaw: lookRef.current.yaw, pitch: lookRef.current.pitch, dist: distRef.current, fov: 42,
    });
  const [bootCam] = useState(() => solveShadow());

  const sendOrbit = () => {
    ctlRef.current?.setOrbit({
      target: frame.target, yaw: lookRef.current.yaw, pitch: lookRef.current.pitch, distance: distRef.current, fov: 42,
    });
  };
  const persistCam = () => {
    writeCamTwig({ yaw: lookRef.current.yaw, pitch: lookRef.current.pitch, dist: distRef.current });
  };

  useEffect(() => {
    const nodeId = Number(cameraRef.current?.id ?? 0);
    if (!nodeId) {
      console.warn('[workbench/clothing] native camera not engaged (node id unavailable)');
      return;
    }
    const ctl = GAME_NATIVE_CAMERA.forNode(nodeId);
    ctlRef.current = ctl;
    ctl.setMode('orbit');
    sendOrbit();
    return () => { ctlRef.current = null; ctl.disable(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- engage once; params ride sendOrbit
  }, []);
  useEffect(() => {
    // a garment switch reframes; the boot keeps the twig's saved pose
    if (bootedRef.current) distRef.current = frame.dist;
    bootedRef.current = true;
    sendOrbit();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reframe on garment switch
  }, [garmentId]);

  const onDown = (e: any) => { dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0) }; };
  const onMove = (e: any) => {
    const drag = dragRef.current;
    if (!drag) return;
    const nx = Number(e?.x ?? 0), ny = Number(e?.y ?? 0);
    const dx = nx - drag.x, dy = ny - drag.y;
    drag.x = nx; drag.y = ny;
    const l = lookRef.current;
    const nextYaw = l.yaw - dx * 0.4;
    const nextPitch = clamp(l.pitch - dy * 0.3, -40, 85);
    ctlRef.current?.setInputDeltas(nextYaw - l.yaw, nextPitch - l.pitch);
    l.yaw = nextYaw;
    l.pitch = nextPitch;
  };
  const onUp = () => { dragRef.current = null; persistCam(); };
  const onWheel = (e: any) => {
    const dy = Number(e?.deltaY ?? 0);
    distRef.current = clamp(distRef.current + (dy > 0 ? 0.25 : -0.25), 0.7, 10);
    sendOrbit();
    persistCam();
  };

  const variants = store.variantsOf(garmentId);
  const selected = store.selectedVariant(garmentId);
  const plainColor = (() => {
    const g = store.garment(garmentId);
    return g?.kind === 'top' ? CLOTHING[g.style].primary : accentFor('controlBg');
  })();

  return (
    <Box style={{ flexGrow: 1, minHeight: 0, flexDirection: 'column' }}>
      {/* offscreen bakes: saved materials + painted designs + the shared prints.
          Each list is VARIABLE-LENGTH: bare among fixed siblings, a length
          change shifts the Scene3D's host child index and the reconciler DROPS
          the scene (reconciler_array_sibling_shift — the buildings stage's
          blank-stage bug). One zero-size container per list keeps every
          sibling index fixed. */}
      <Box style={{ width: 0, height: 0 }}>
        {r.mounts.map((m) => (
          <TextureCapture key={m.staticKey} textureId={m.textureId} staticKey={m.staticKey}
            widthPx={TEX_PX} heightPx={TEX_PX} cols={1} floors={1} perception={NEUTRAL_PERCEPTION} />
        ))}
      </Box>
      <Box style={{ width: 0, height: 0 }}>
        {r.overlayMounts.map((m) => (
          <PaintedOverlaySurface key={m.staticKey} staticKey={m.staticKey} bg="#ffffff" w={256} h={192} overlay={m.overlay} />
        ))}
      </Box>
      <Box style={{ width: 0, height: 0 }}>
        {r.needsSkinCaptures ? <ClothingSkinCaptures /> : null}
      </Box>
      <Pressable
        onLayout={(lr: any) => { rectRef.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height }; }}
        onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onWheel={onWheel}
        style={{ width: '100%', flexGrow: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}
      >
        <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={accentFor('bgElevated')} showGrid={false} showAxes={false}>
          {/* THE stage kit's studio environment — the same LabEnvironment
              every character stage mounts (CLOTHFLIP: the near-black-blob
              verdict; sky + key light + floor, no void) — PLUS two front
              fills: the kit's key comes from +Z, but a garment's print
              faces −Z (the chest); without fill the artwork reads as a
              ghost. Studio fill lights, the photography answer. */}
          <LabEnvironment preset="studio" />
          <Scene3D.PointLight position={[-1.6, 1.5, -2.4]} color="#ffffff" intensity={0.6} />
          <Scene3D.PointLight position={[1.6, 1.5, -2.4]} color="#ffffff" intensity={0.6} />
          <Scene3D.Camera nativeCamera ref={cameraRef} position={bootCam.pos} target={bootCam.target} fov={bootCam.fov} />
          {r.instances.map((inst, i) => (
            <Scene3D.Mesh
              key={`g${i}`}
              geometry={clothingGeometry(inst.geometry)}
              params={inst.params}
              material={inst.textureKey ? '#ffffff' : inst.color}
              textureKey={inst.textureKey}
              position={inst.position}
              rotation={inst.rotation ?? [0, 0, 0]}
              scale={inst.scale ?? 1}
            />
          ))}
        </Scene3D>
        <Text fontSize={9} color={accentFor('textSecondary')} style={{ position: 'absolute', right: 14, top: 14, fontWeight: 800, letterSpacing: 1 }}>
          GARMENT ALONE
        </Text>
      </Pressable>
      {/* THE VARIANT GRID — the designs themselves, visible; click selects */}
      <Box style={{ borderTopWidth: 1, borderTopColor: accentFor('border'), paddingTop: 7, paddingBottom: 5 }}>
        <ScrollView showScrollbar style={{ width: '100%', maxHeight: 196 }}>
          <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingLeft: 12, paddingRight: 12, paddingBottom: 4 }}>
            {variants.map((v) => (
              <VariantSwatch key={v.id} v={v} plainColor={plainColor} selected={v.id === selected}
                onPick={() => store.selectVariant(garmentId, v.id)} />
            ))}
          </Box>
        </ScrollView>
      </Box>
      <Box style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 2, paddingBottom: 7 }}>
        <Text fontSize={9} color={accentFor('textSecondary')} style={{ fontFamily: 'monospace' }}>
          {`${r.caption} · ${r.instances.length} pieces · click a variant to wear it · drag orbit · wheel zoom`}
        </Text>
      </Box>
    </Box>
  );
}
