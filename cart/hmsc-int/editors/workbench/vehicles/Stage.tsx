// editors/workbench/vehicles/Stage.tsx -- VEHICLE column 4 demonstration.
// The panel owns all document edits; this stage renders the vehicle, orbit,
// overlays, captures, and the PAINT doorway.

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Pressable, Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import {
  GAME_ANIMATION,
  GAME_CAMERA,
  GAME_CHROME,
  GAME_NATIVE_CAMERA,
  GAME_VEHICLE,
  type VehicleBuild,
  type VehiclePartId,
} from '../../../game';
import { VehiclePaintCaptures } from '../../../game/paintedRender';
import { VehiclePaintLens } from './PaintLens';
import type { VehicleLens, VehicleStore } from './store';

const T = GAME_CHROME.tokens.color;

const VIEW_TUNING = {
  orbit: { yawPerPixel: 0.38, pitchPerPixel: 0.3, minPitch: 5, maxPitch: 82, fov: 42, target: [0, 0.8, 0] as [number, number, number] },
  playback: { frameMs: 33, secondsPerFrame: 1 / 60 },
  highlight: { scale: 1.04 },
};

function geometryFor(kind: 'box' | 'cylinder' | 'sphere') {
  return kind === 'cylinder' ? Geometry.Cylinder : kind === 'sphere' ? Geometry.Sphere : Geometry.Box;
}

const VehicleMeshes = memo(function VehicleMeshes(props: {
  build: VehicleBuild;
  selected: VehiclePartId | null;
  showHitboxes: boolean;
  showAnchors: boolean;
}) {
  const box = GAME_VEHICLE.tables.meshParams.box;
  return (
    <>
      {props.build.meshes.map((m, i) => (
        <Scene3D.Mesh
          key={`${m.id}.${i}`}
          geometry={geometryFor(m.kind)}
          params={m.params}
          position={m.position}
          rotation={m.rotation ?? [0, 0, 0]}
          scale={m.scale}
          material={m.textureKey ? '#ffffff' : m.material}
          textureKey={m.textureKey}
        />
      ))}
      {props.selected ? props.build.hitboxes.filter((h) => h.id === props.selected).map((h, i) => (
        <Scene3D.Mesh
          key={`selected-${h.id}.${i}`}
          geometry={Geometry.Box}
          params={box}
          position={h.position}
          rotation={h.rotation ?? [0, 0, 0]}
          scale={[h.size[0] * VIEW_TUNING.highlight.scale, h.size[1] * VIEW_TUNING.highlight.scale, h.size[2] * VIEW_TUNING.highlight.scale]}
          material={{ color: T.warn, opacity: 0.28 }}
        />
      )) : null}
      {props.showHitboxes ? props.build.hitboxes.map((h, i) => (
        <Scene3D.Mesh
          key={`hitbox-${h.id}.${i}`}
          geometry={Geometry.Box}
          params={box}
          position={h.position}
          rotation={h.rotation ?? [0, 0, 0]}
          scale={h.size}
          material={{ color: h.damage >= 3 ? '#ef4444' : h.damage >= 2 ? '#f97316' : h.damage >= 1 ? '#facc15' : h.critical ? '#fb7185' : '#38bdf8', opacity: 0.18 }}
        />
      )) : null}
      {props.showAnchors ? Object.entries(props.build.anchors).map(([id, p]) => (
        <Scene3D.Mesh
          key={`anchor-${id}`}
          geometry={Geometry.Sphere}
          params={{ radius: 0.5, segments: 12, rings: 8 }}
          position={p as [number, number, number]}
          scale={0.08}
          material={id === 'gasPort' ? '#eab308' : '#34d399'}
        />
      )) : null}
    </>
  );
});

export function VehicleStage(props: { store: VehicleStore; lens: VehicleLens }) {
  if (props.lens === 'paint') return <VehiclePaintLens store={props.store} />;
  return <VehiclePreviewStage store={props.store} />;
}

function VehiclePreviewStage(props: { store: VehicleStore }) {
  const s = props.store;
  const [, setTick] = useState(0);
  useEffect(() => s.subscribe(() => setTick((t) => t + 1)), [s]);

  const doc = s.doc;
  const cameraRef = useRef<any>(null);
  const camCtlRef = useRef<ReturnType<typeof GAME_NATIVE_CAMERA.forNode> | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const lookRef = useRef(s.view.orbitLook);
  lookRef.current = s.view.orbitLook;

  useEffect(() => {
    if (!s.view.running) return;
    const id = setInterval(() => s.tickFrame(), VIEW_TUNING.playback.frameMs);
    return () => clearInterval(id);
  }, [s, s.view.running]);

  const poseDef = GAME_VEHICLE.tables.poses[s.view.pose];
  const seconds = (s.view.running ? s.frame : 0) * VIEW_TUNING.playback.secondsPerFrame;
  const timeline = useMemo(() => GAME_ANIMATION.parse(poseDef.dsl), [poseDef.dsl]);
  const sampledActions = useMemo(() => GAME_ANIMATION.sample(timeline, seconds), [timeline, seconds]);
  const build = useMemo(() => (doc ? GAME_VEHICLE.build(doc, sampledActions) : null), [doc, sampledActions]);

  const [bootCam] = useState(() =>
    GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, {
      target: VIEW_TUNING.orbit.target,
      yaw: lookRef.current.yaw,
      pitch: lookRef.current.pitch,
      dist: s.view.orbitDistance,
      zoom: 1,
      fov: VIEW_TUNING.orbit.fov,
    }));

  const sendOrbit = (distance: number) => {
    const l = lookRef.current;
    camCtlRef.current?.setOrbit({
      target: VIEW_TUNING.orbit.target,
      yaw: l.yaw,
      pitch: l.pitch,
      distance,
      fov: VIEW_TUNING.orbit.fov,
      zoom: 1,
    });
  };

  useEffect(() => {
    const nodeId = Number(cameraRef.current?.id ?? 0);
    if (!nodeId) return;
    const ctl = GAME_NATIVE_CAMERA.forNode(nodeId);
    camCtlRef.current = ctl;
    sendOrbit(s.view.orbitDistance);
    ctl.setMode('orbit');
    return () => {
      camCtlRef.current = null;
      ctl.disable();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- engage once
  }, []);

  useEffect(() => { sendOrbit(s.view.orbitDistance); }, [s.view.orbitDistance]);

  const orbitDown = (e: any) => { dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0) }; };
  const orbitMove = (e: any) => {
    const d = dragRef.current;
    if (!d) return;
    const nx = Number(e?.x ?? 0);
    const ny = Number(e?.y ?? 0);
    const dx = nx - d.x;
    const dy = ny - d.y;
    d.x = nx;
    d.y = ny;
    const l = lookRef.current;
    const nextYaw = l.yaw - dx * VIEW_TUNING.orbit.yawPerPixel;
    const nextPitch = Math.max(VIEW_TUNING.orbit.minPitch, Math.min(VIEW_TUNING.orbit.maxPitch, l.pitch - dy * VIEW_TUNING.orbit.pitchPerPixel));
    camCtlRef.current?.setInputDeltas(nextYaw - l.yaw, nextPitch - l.pitch);
    lookRef.current = { yaw: nextYaw, pitch: nextPitch };
  };
  const orbitUp = () => {
    s.setOrbitLook({ ...lookRef.current });
    dragRef.current = null;
  };

  return (
    <Pressable
      onMouseDown={orbitDown}
      onMouseMove={orbitMove}
      onMouseUp={orbitUp}
      style={{ flexGrow: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}
    >
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={T.page}>
        <Scene3D.Camera nativeCamera ref={cameraRef} position={bootCam.pos} target={bootCam.target} fov={bootCam.fov} />
        <GAME_CHROME.LabEnvironment preset="arena" />
        {build ? <VehicleMeshes build={build} selected={s.view.selectedPart} showHitboxes={s.view.showHitboxes} showAnchors={s.view.showAnchors} /> : null}
      </Scene3D>
      {doc ? <VehiclePaintCaptures doc={doc} /> : null}
      <Box style={{ position: 'absolute', right: 14, bottom: 14 }}>
        <GAME_CHROME.Knob label="zoom" value={s.view.orbitDistance} spec={GAME_CHROME.knobPresets['orbit.zoom']} onChange={s.setOrbitDistance} />
      </Box>
    </Pressable>
  );
}
