// assist3d/AssistMeshViewer — frames a single generated MeshSpec in its own
// orbiting Scene3D. The Objects explorer uses this for the ASSISTANT category
// (the game's ModelViewer only knows building/prop/tile kinds, not raw geometry),
// and it doubles as a thumbnail-grade inspector preview.

import { useMemo, useRef, useState } from 'react';
import { Pressable, Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import { solveCamera, CAMERAS, type Vec3 } from '@reactjit/cameras';
import { boundingRadius, type MeshSpec } from './scene';

export function AssistMeshViewer(props: { mesh: MeshSpec; background?: string }) {
  const { mesh } = props;
  const [yaw, setYaw] = useState(38);
  const [pitch, setPitch] = useState(26);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  // frame distance from the mesh's enclosing sphere; sit the target at its center
  const R = boundingRadius(mesh.geometry, mesh.params) * (mesh.scale ?? 1);
  const dist = Math.max(2.5, R * 3.2);
  const target = mesh.position as Vec3;

  // solve to a plain {pos,target,fov} and feed <Scene3D.Camera> directly (no rig
  // wrapper element re-created per drag) — same no-lag pattern as IsoPreview.
  const solved = useMemo(
    () => solveCamera(CAMERAS.Orbit, { target, yaw, pitch, dist, zoom: 1, fov: 48 }),
    [target[0], target[1], target[2], yaw, pitch, dist],
  );

  const onDown = (e: any) => { dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0) }; };
  const onMove = (e: any) => {
    const d = dragRef.current; if (!d) return;
    const nx = Number(e?.x ?? 0), ny = Number(e?.y ?? 0);
    setYaw((v) => v + (nx - d.x) * 0.5);
    setPitch((v) => Math.max(6, Math.min(85, v - (ny - d.y) * 0.4)));
    d.x = nx; d.y = ny;
  };
  const onUp = () => { dragRef.current = null; };

  return (
    <Pressable onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} style={{ width: '100%', height: '100%' }}>
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={props.background ?? '#0a111d'} showGrid={true} showAxes={false}>
        <Scene3D.Camera position={solved.pos} target={solved.target} fov={solved.fov} />
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
