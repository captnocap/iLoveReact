// assist3d/AssistMeshViewer — frames a single generated MeshSpec in its own
// orbiting Scene3D. The Objects explorer uses this for the ASSISTANT category
// (the game's ModelViewer only knows building/prop/tile kinds, not raw geometry),
// and it doubles as a thumbnail-grade inspector preview.

import { useEffect, useRef, useState } from 'react';
import { Pressable, Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import { GAME_CAMERA, GAME_NATIVE_CAMERA } from '../game';
import { boundingRadius, type MeshSpec } from './scene';

type Vec3 = [number, number, number];

export function AssistMeshViewer(props: { mesh: MeshSpec; background?: string }) {
  const { mesh } = props;
  const lookRef = useRef({ yaw: 38, pitch: 26 });
  const cameraRef = useRef<any>(null);
  const cameraCtlRef = useRef<ReturnType<typeof GAME_NATIVE_CAMERA.forNode> | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  // frame distance from the mesh's enclosing sphere; sit the target at its center
  const R = boundingRadius(mesh.geometry, mesh.params) * (mesh.scale ?? 1);
  const dist = Math.max(2.5, R * 3.2);
  const target = mesh.position as Vec3;

  const [bootCam] = useState(() =>
    GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, { target, yaw: lookRef.current.yaw, pitch: lookRef.current.pitch, dist, zoom: 1, fov: 48 }));

  const sendOrbit = () => {
    const l = lookRef.current;
    cameraCtlRef.current?.setOrbit({ target, yaw: l.yaw, pitch: l.pitch, distance: dist, zoom: 1, fov: 48 });
  };

  useEffect(() => {
    const nodeId = Number(cameraRef.current?.id ?? 0);
    if (!nodeId) {
      console.warn('[assist-mesh] native camera not engaged — camera node id unavailable');
      return;
    }
    const ctl = GAME_NATIVE_CAMERA.forNode(nodeId);
    cameraCtlRef.current = ctl;
    ctl.setOrbit({ target, yaw: lookRef.current.yaw, pitch: lookRef.current.pitch, distance: dist, zoom: 1, fov: 48 });
    ctl.setMode('orbit');
    return () => {
      cameraCtlRef.current = null;
      ctl.disable();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- engage once; target changes ride the effect below
  }, []);

  useEffect(() => { sendOrbit(); }, [target[0], target[1], target[2], dist]);

  const onDown = (e: any) => { dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0) }; };
  const onMove = (e: any) => {
    const d = dragRef.current; if (!d) return;
    const nx = Number(e?.x ?? 0), ny = Number(e?.y ?? 0);
    const dx = nx - d.x, dy = ny - d.y;
    const l = lookRef.current;
    const nextYaw = l.yaw - dx * 0.5;
    const nextPitch = Math.max(6, Math.min(85, l.pitch - dy * 0.4));
    cameraCtlRef.current?.setInputDeltas(nextYaw - l.yaw, nextPitch - l.pitch);
    l.yaw = nextYaw;
    l.pitch = nextPitch;
    d.x = nx; d.y = ny;
  };
  const onUp = () => { dragRef.current = null; };

  return (
    <Pressable onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} style={{ width: '100%', height: '100%' }}>
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={props.background ?? '#0a111d'} showGrid={true} showAxes={false}>
        <Scene3D.Camera nativeCamera ref={cameraRef} position={bootCam.pos} target={bootCam.target} fov={bootCam.fov} />
        <Scene3D.AmbientLight color="#5b6488" intensity={0.75} />
        <Scene3D.DirectionalLight direction={[0.5, 0.9, 0.35]} color="#ffd9a8" intensity={0.9} />
        <Scene3D.PointLight position={[-6, 6, -4]} color="#39d6ff" intensity={0.3} />
        <Scene3D.Mesh
          geometry={Geometry.GEOMETRIES[mesh.geometry]}
          params={mesh.params}
          material={mesh.material}
          position={mesh.position}
          rotation={mesh.rotation ?? [0, 0, 0]}
          scale={mesh.scale ?? 1}
        />
      </Scene3D>
    </Pressable>
  );
}
