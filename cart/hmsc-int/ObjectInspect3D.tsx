// ObjectInspect3D — a pickable 3D viewer for ONE object (building or prop).
//
// This is the assist3d inspector (assist3d/SceneSurface + picking.ts) pointed at
// the game's own models: orbit, then CLICK a part of the model to select it. It
// replaces the old "front/back/left/right/top" face buttons, which only described
// a box — a parking garage has no "front face", but it has a deck and pillars you
// can click; a sign has a panel. The pickable parts come from buildingParts /
// propParts (render3d), the SAME list the game renders, so what you click is what
// gets textured.
//
// CAMNUKE-0605: the renderer camera is the V23 native host controller. JS keeps
// only a semantic pick shadow from the registry so click selection stays exact.
// The model is drawn through ModelScene (the real Building3D / facades / Prop),
// and the offscreen texture captures are mounted as 2D siblings so an applied
// texture actually bakes and shows.

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Pressable, Scene3D, Text } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import { pickMesh } from './assist3d/picking';
import { GAME_CAMERA, GAME_NATIVE_CAMERA } from './game';
import type { Building, WorldProp } from '../hmsc/design';
import { buildingParts } from '../hmsc/render3d/buildingParts';
import { propParts } from '../hmsc/render3d/propParts';
import type { Part } from '../hmsc/render3d/parts';
import { BuildingSurfaceCaptures } from '../hmsc/render3d/BuildingFacades';
import { PropSurfaceCaptures } from '../hmsc/render3d/PropCaptures';
import { WorldPartCaptures, BuildingTexturedFaces } from '../hmsc/render3d/PartCaptures';
import { ModelScene } from './ModelViewer';
import { accentFor } from './studio.cls';

type Vec3 = [number, number, number];
type Rect = { x: number; y: number; width: number; height: number };

const NEUTRAL_PERCEPTION = { high: 0 };

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }

export const ObjectInspect3D = memo(function ObjectInspect3D(props: {
  building?: Building;
  prop?: WorldProp;
  baseDist: number;
  targetY: number;
  background?: string;
  selectedPartId: string | null;
  onPick: (partId: string | null) => void;
  onAdd?: () => void;
}) {
  const { building, prop, selectedPartId } = props;
  const lookRef = useRef({ yaw: 35, pitch: 26 });
  const distRef = useRef(props.baseDist);
  const cameraRef = useRef<any>(null);
  const cameraCtlRef = useRef<ReturnType<typeof GAME_NATIVE_CAMERA.forNode> | null>(null);

  const rectRef = useRef<Rect>({ x: 0, y: 0, width: 800, height: 600 });
  const dragRef = useRef<{ x: number; y: number; dist: number } | null>(null);

  const parts = useMemo<Part[]>(
    () => (building ? buildingParts(building) : prop ? propParts(prop) : []),
    [building, prop],
  );

  const solveShadow = (look = lookRef.current, distance = distRef.current) =>
    GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, { target: [0, props.targetY, 0] as Vec3, yaw: look.yaw, pitch: look.pitch, dist: distance, zoom: 1, fov: 38 });
  const shadowCamRef = useRef(solveShadow());
  const [bootCam] = useState(() => shadowCamRef.current);
  const sendOrbit = () => {
    const l = lookRef.current;
    shadowCamRef.current = solveShadow(l, distRef.current);
    cameraCtlRef.current?.setOrbit({ target: [0, props.targetY, 0], yaw: l.yaw, pitch: l.pitch, distance: distRef.current, zoom: 1, fov: 38 });
  };

  useEffect(() => {
    const nodeId = Number(cameraRef.current?.id ?? 0);
    if (!nodeId) {
      console.warn('[object-inspect] native camera not engaged — camera node id unavailable');
      return;
    }
    const ctl = GAME_NATIVE_CAMERA.forNode(nodeId);
    cameraCtlRef.current = ctl;
    ctl.setOrbit({ target: [0, props.targetY, 0], yaw: lookRef.current.yaw, pitch: lookRef.current.pitch, distance: distRef.current, zoom: 1, fov: 38 });
    ctl.setMode('orbit');
    return () => {
      cameraCtlRef.current = null;
      ctl.disable();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- engage once; param changes ride effects/input below
  }, []);

  useEffect(() => {
    distRef.current = props.baseDist;
    sendOrbit();
  }, [props.baseDist, props.targetY]);

  const onDown = (e: any) => { dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0), dist: 0 }; };
  const onMove = (e: any) => {
    const d = dragRef.current; if (!d) return;
    const nx = Number(e?.x ?? 0), ny = Number(e?.y ?? 0);
    const dx = nx - d.x, dy = ny - d.y;
    d.dist += Math.abs(dx) + Math.abs(dy); d.x = nx; d.y = ny;
    const l = lookRef.current;
    const nextYaw = l.yaw - dx * 0.4;
    const nextPitch = clamp(l.pitch - dy * 0.3, 6, 85);
    cameraCtlRef.current?.setInputDeltas(nextYaw - l.yaw, nextPitch - l.pitch);
    l.yaw = nextYaw;
    l.pitch = nextPitch;
    shadowCamRef.current = solveShadow();
  };
  const onUp = (e: any) => {
    const d = dragRef.current; dragRef.current = null;
    if (!d || d.dist >= 6) return;                       // a drag, not a tap
    const r = rectRef.current;
    const sx = Number(e?.x ?? 0) - r.x, sy = Number(e?.y ?? 0) - r.y;
    const hit = pickMesh(sx, sy, r, shadowCamRef.current, parts);
    props.onPick(hit >= 0 ? parts[hit].id : null);
  };
  const onWheel = (e: any) => {
    const dy = Number(e?.deltaY ?? e?.dy ?? 0);
    distRef.current = clamp(distRef.current + (dy > 0 ? 1 : -1) * Math.max(1, props.baseDist * 0.08), 3, props.baseDist * 3);
    sendOrbit();
  };

  // Highlight every part SHARING the selected id (a part group — e.g. all pillars
  // — selects together), a translucent shell just proud of the real mesh.
  const ACCENT = accentFor('primary');
  const selected = useMemo(() => (selectedPartId ? parts.filter((p) => p.id === selectedPartId) : []), [parts, selectedPartId]);

  return (
    <Box style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Offscreen texture captures (2D siblings) so applied textures bake + show:
          box-building skins, the sign route plate + any prop part textures, and the
          open-structure / prop part-texture overrides. Scoped to this one object. */}
      <BuildingSurfaceCaptures buildings={building ? [building] : []} perception={NEUTRAL_PERCEPTION} />
      <PropSurfaceCaptures props={prop ? [prop] : []} />
      <WorldPartCaptures buildings={building ? [building] : []} props={prop ? [prop] : []} perception={NEUTRAL_PERCEPTION} />

      <Pressable
        onLayout={(lr: any) => { rectRef.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height }; }}
        onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onWheel={onWheel}
        style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}
      >
        <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={props.background ?? '#0e1622'} showGrid showAxes={false}>
          <Scene3D.Camera nativeCamera ref={cameraRef} position={bootCam.pos} target={bootCam.target} fov={bootCam.fov} />
          <ModelScene building={building} prop={prop} />
          {/* Box-building face textures from the part-texture channel (skin panels
              come from ModelScene's BuildingFacades; this adds the global ones). */}
          <BuildingTexturedFaces buildings={building ? [building] : []} />
          {selected.map((p, i) => (
            <Scene3D.Mesh
              key={`sel-${i}`}
              geometry={Geometry.GEOMETRIES[p.geometry] ?? Geometry.Box}
              params={p.params}
              position={p.position}
              rotation={p.rotation ?? [0, 0, 0]}
              scale={(() => {
                const s = p.scale ?? 1;
                return Array.isArray(s) ? [s[0] * 1.06, s[1] * 1.06, s[2] * 1.06] as Vec3 : (s as number) * 1.06;
              })()}
              material={{ color: ACCENT, opacity: 0.3 }}
            />
          ))}
        </Scene3D>
      </Pressable>

      {/* + drops this object into the painter's place layer. */}
      {props.onAdd ? (
        <Pressable onPress={props.onAdd} style={{ position: 'absolute', right: 6, top: 6, width: 26, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 4, borderWidth: 1, borderColor: '#22c55e', backgroundColor: '#0f3d2ecc' }}>
          <Text fontSize={14} color="#86efac" style={{ fontWeight: 800 }}>+</Text>
        </Pressable>
      ) : null}
      <Text fontSize={8} color={accentFor('textFaint')} style={{ fontFamily: 'monospace', position: 'absolute', left: 8, bottom: 6 }}>
        {parts.length ? 'drag orbit · wheel zoom · click a part to texture it' : 'drag orbit · wheel zoom'}
      </Text>
    </Box>
  );
});
