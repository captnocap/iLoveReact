// ModelViewer — a real 3D viewer for a SINGLE object (not the map).
//
// Two things the map preview (IsoPreview) can't do, both delivered here:
//
//  1. No sky / fog. The map preview reuses WorldStatics, which bakes in a
//     <Scene3D.Skybox>. This viewer renders ONLY the object's own meshes
//     (Building3D / Prop / a tile slab) + neutral studio lights under a flat
//     backgroundColor — no Skybox, no Fog — so the model reads on a clean field.
//
//  2. Orbit + zoom by mouse, not buttons. CAMNUKE-0605: the viewport camera is
//     the V23 native host controller; JS only sends params/deltas on input.

import { useEffect, useRef, useState } from 'react';
import { Box, Pressable, Scene3D, Text } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import { busOn } from '@reactjit/hooks/useIFTTT';
import { GAME_CAMERA, GAME_NATIVE_CAMERA } from './game';
import type { PlacedBuildPiece } from './game';
import type { Building, TileKind, WorldProp } from '../hmsc/design';
import { Building3D } from '../hmsc/render3d/Building';
import { BuildingFacades } from '../hmsc/render3d/BuildingFacades';
import { Prop } from '../hmsc/render3d/Prop';
import { tileKindDefinition } from '../hmsc/world/tileKinds';
import { PlacedPieceMeshes } from './editors/build/pieceMeshes';

const ORBIT_SPEED = 0.4; // degrees per cursor pixel
const ZOOM_STEP = 1.1;

// V24 prefabs inspect as their decomposed pieces — the studio viewer just draws
// the standing composition (no selection / occlusion state).
const NO_IDS: ReadonlySet<string> = new Set();

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }

// The scene contents (studio lights + the object's meshes), factored out so a
// palette THUMBNAIL can render the exact same model under a fixed camera. Must
// be a child of a <Scene3D>. No camera / no input here — the wrapper owns those.
// `facades` (default true) bakes the storefront skin onto the walls — skip it
// for tiny thumbnails (massing alone differentiates kinds, and a per-chip facade
// capture is the expensive part / unreadable at that size).
export function ModelScene(props: { building?: Building; prop?: WorldProp; tile?: TileKind; pieces?: readonly PlacedBuildPiece[]; facades?: boolean }) {
  return (
    <>
      {/* studio lighting, no fog — read flat + fully lit */}
      <Scene3D.Fog enabled={false} />
      <Scene3D.AmbientLight color="#ffffff" intensity={0.55} />
      <Scene3D.DirectionalLight direction={[0.5, 1, 0.35]} color="#ffffff" intensity={0.95} />
      {props.building ? <Building3D building={props.building} /> : null}
      {props.building && props.facades !== false ? <BuildingFacades buildings={[props.building]} /> : null}
      {props.prop ? <Prop prop={props.prop} /> : null}
      {/* V24 prefab: its decomposed pieces, drawn by the one PlacedPieceMeshes
          renderer F2/iso also use (change a wall's look there, it changes here). */}
      {props.pieces && props.pieces.length > 0 ? (
        <PlacedPieceMeshes pieces={props.pieces} markedIds={NO_IDS} targetId={null} occludedIds={NO_IDS} />
      ) : null}
      {props.tile ? ((() => {
        const h = Math.max(0.3, tileKindDefinition(props.tile).render.heightMeters);
        return <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 8, height: h, depth: 8 }} color={tileKindDefinition(props.tile).render.color} position={[0, h / 2, 0]} />;
      })()) : null}
    </>
  );
}

export function ModelViewer(props: {
  building?: Building;
  prop?: WorldProp;
  tile?: TileKind;
  pieces?: readonly PlacedBuildPiece[];
  baseDist: number;
  targetY: number;
  background?: string;
  onAdd?: () => void; // when set, a + button drops this object into the place layer
}) {
  const lookRef = useRef({ yaw: 35, pitch: 26 });
  const zoomRef = useRef(1);
  const cameraRef = useRef<any>(null);
  const cameraCtlRef = useRef<ReturnType<typeof GAME_NATIVE_CAMERA.forNode> | null>(null);
  const draggingRef = useRef(false);

  const sendOrbit = () => {
    const l = lookRef.current;
    cameraCtlRef.current?.setOrbit({ target: [0, props.targetY, 0], yaw: l.yaw, pitch: l.pitch, distance: props.baseDist, zoom: zoomRef.current, fov: 38 });
  };

  useEffect(() => {
    const nodeId = Number(cameraRef.current?.id ?? 0);
    if (!nodeId) {
      console.warn('[model-viewer] native camera not engaged — camera node id unavailable');
      return;
    }
    const ctl = GAME_NATIVE_CAMERA.forNode(nodeId);
    cameraCtlRef.current = ctl;
    ctl.setOrbit({ target: [0, props.targetY, 0], yaw: lookRef.current.yaw, pitch: lookRef.current.pitch, distance: props.baseDist, zoom: zoomRef.current, fov: 38 });
    ctl.setMode('orbit');
    return () => {
      cameraCtlRef.current = null;
      ctl.disable();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- engage once; param changes ride effects/input below
  }, []);

  useEffect(() => { sendOrbit(); }, [props.targetY, props.baseDist]);

  // Drag → orbit, driven by the host's global cursor deltas (no per-node move
  // handler → no capture gaps). No-op unless a press is active on the input layer.
  useEffect(() => busOn('system:cursor:move', (e: any) => {
    if (!draggingRef.current) return;
    const dx = Number(e?.dx ?? 0);
    const dy = Number(e?.dy ?? 0);
    const l = lookRef.current;
    const nextYaw = l.yaw - dx * ORBIT_SPEED;
    const nextPitch = clamp(l.pitch - dy * ORBIT_SPEED, 4, 88);
    cameraCtlRef.current?.setInputDeltas(nextYaw - l.yaw, nextPitch - l.pitch);
    l.yaw = nextYaw;
    l.pitch = nextPitch;
  }), []);

  // Wheel up (deltaY > 0) zooms in — matches the 2D canvas zoom convention.
  // Zoom drives the OrbitCamera's effective distance (dist / zoom), so this is a
  // real camera dolly in world space, not a 2D scale of the rendered frame.
  const onScroll = (payload: any) => {
    const dz = Number(payload?.deltaY ?? 0);
    if (!dz) return;
    zoomRef.current = clamp(zoomRef.current * (dz > 0 ? ZOOM_STEP : 1 / ZOOM_STEP), 0.3, 6);
    sendOrbit();
  };

  const reset = () => {
    lookRef.current = { yaw: 35, pitch: 26 };
    zoomRef.current = 1;
    sendOrbit();
  };

  const [bootCam] = useState(() =>
    GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, { target: [0, props.targetY, 0], yaw: 35, pitch: 26, dist: props.baseDist, zoom: 1, fov: 38 }));

  return (
    <Box style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={props.background ?? '#0e1622'} showGrid showAxes={false}>
        <Scene3D.Camera nativeCamera ref={cameraRef} position={bootCam.pos} target={bootCam.target} fov={bootCam.fov} />
        <ModelScene building={props.building} prop={props.prop} tile={props.tile} pieces={props.pieces} />
      </Scene3D>

      {/* Transparent input layer over the scene: drag orbits, wheel zooms. */}
      <Pressable
        onMouseDown={() => { draggingRef.current = true; }}
        onMouseUp={() => { draggingRef.current = false; }}
        onScroll={onScroll}
        style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#00000000' }}
      />
      {/* Controls render after the input layer, so they stay clickable. */}
      <Pressable onPress={reset} style={{ position: 'absolute', right: 6, top: 6, paddingLeft: 7, paddingRight: 7, paddingTop: 3, paddingBottom: 3, borderRadius: 4, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0b1424cc' }}>
        <Text fontSize={9} color="#cbd5e1" style={{ fontFamily: 'monospace' }}>reset</Text>
      </Pressable>
      {/* + drops this object into the painter's place layer. */}
      {props.onAdd ? (
        <Pressable onPress={props.onAdd} style={{ position: 'absolute', right: 6, top: 32, width: 26, height: 22, alignItems: 'center', justifyContent: 'center', borderRadius: 4, borderWidth: 1, borderColor: '#22c55e', backgroundColor: '#0f3d2ecc' }}>
          <Text fontSize={14} color="#86efac" style={{ fontWeight: 800 }}>+</Text>
        </Pressable>
      ) : null}
      <Text fontSize={8} color="#3a4a63" style={{ fontFamily: 'monospace', position: 'absolute', left: 8, bottom: 6 }}>drag orbit · scroll zoom</Text>
    </Box>
  );
}
