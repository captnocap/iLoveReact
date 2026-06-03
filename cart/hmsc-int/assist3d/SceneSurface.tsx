// assist3d/SceneSurface — the center 3D surface, isolated so dragging it never
// re-renders the chat/transcript/inspector around it.
//
// Two reasons this is its own memo'd component (the IsoPreview lesson):
//   1. Orbit state (yaw/pitch/dist) lives HERE, so a drag re-renders only the
//      surface — not the parent route with its streaming chat log.
//   2. The camera is a plain <Scene3D.Camera position target fov> solved inline,
//      NOT an <OrbitCamera> rig element re-created each render. Same Solved drives
//      BOTH the render and the pick, so click selection stays exact.
//
// The scene meshes are memoized on `scene` identity, so orbiting never re-ships
// vertices across the bridge. The ground is just mesh #0 (a real, exported,
// selectable Box) — there's no decorative grid standing in for it (showGrid off).

import { memo, useMemo, useRef, useState } from 'react';
import { Box, Pressable, Scene3D, Text } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import { solveCamera, CAMERAS, type Vec3, type Rect } from '@reactjit/cameras';
import { accentFor } from '../studio.cls';
import { pickMesh } from './picking';
import type { SceneSpec } from './scene';

export const SceneSurface = memo(function SceneSurface(props: {
  scene: SceneSpec;
  selected: number | null;
  onPick: (index: number | null) => void;
}) {
  const { scene, selected } = props;
  const [yaw, setYaw] = useState(38);
  const [pitch, setPitch] = useState(28);
  const [dist, setDist] = useState(12);

  const rectRef = useRef<Rect>({ x: 0, y: 0, width: 800, height: 700 });
  const dragRef = useRef<{ x: number; y: number; dist: number } | null>(null);

  const solved = useMemo(
    () => solveCamera(CAMERAS.Orbit, { target: [0, 1, 0] as Vec3, yaw, pitch, dist, zoom: 1, fov: 52 }),
    [yaw, pitch, dist],
  );

  const onDown = (e: any) => { dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0), dist: 0 }; };
  const onMove = (e: any) => {
    const d = dragRef.current; if (!d) return;
    const nx = Number(e?.x ?? 0), ny = Number(e?.y ?? 0);
    const dx = nx - d.x, dy = ny - d.y;
    d.dist += Math.abs(dx) + Math.abs(dy); d.x = nx; d.y = ny;
    setYaw((v) => v + dx * 0.4);
    setPitch((v) => Math.max(6, Math.min(85, v - dy * 0.3)));
  };
  const onUp = (e: any) => {
    const d = dragRef.current; dragRef.current = null;
    if (!d || d.dist >= 6) return;                       // a drag, not a tap
    const r = rectRef.current;
    const sx = Number(e?.x ?? 0) - r.x, sy = Number(e?.y ?? 0) - r.y;
    const hit = pickMesh(sx, sy, r, solved, scene.meshes);
    props.onPick(hit >= 0 ? hit : null);
  };
  const onWheel = (e: any) => {
    const dy = Number(e?.deltaY ?? e?.dy ?? 0);
    setDist((v) => Math.max(3, Math.min(40, v + (dy > 0 ? 1 : -1) * 1.1)));
  };

  const sceneMeshes = useMemo(() => scene.meshes.map((m, i) => (
    <Scene3D.Mesh
      key={m.id + '#' + i}
      geometry={Geometry.GEOMETRIES[m.geometry]}
      params={m.params}
      material={m.material}
      position={m.position}
      rotation={m.rotation ?? [0, 0, 0]}
      scale={m.scale ?? 1}
    />
  )), [scene]);

  const selMesh = selected != null ? scene.meshes[selected] : null;
  const ACCENT = accentFor('primary');

  return (
    <Pressable
      onLayout={(lr: any) => { rectRef.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height }; }}
      onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onWheel={onWheel}
      style={{ flexGrow: 1, position: 'relative', overflow: 'hidden' }}
    >
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={scene.background} showGrid={false} showAxes={false}>
        <Scene3D.Camera position={solved.pos} target={solved.target} fov={solved.fov} />
        <Scene3D.AmbientLight color="#5b6488" intensity={0.7} />
        <Scene3D.DirectionalLight direction={[0.5, 0.9, 0.35]} color="#ffd9a8" intensity={0.9} />
        <Scene3D.PointLight position={[-7, 6, -4]} color="#39d6ff" intensity={0.3} />
        {sceneMeshes}
        {selMesh ? (
          <Scene3D.Mesh
            geometry={Geometry.GEOMETRIES[selMesh.geometry]}
            params={selMesh.params}
            material={{ color: ACCENT, opacity: 0.28 }}
            position={selMesh.position}
            rotation={selMesh.rotation ?? [0, 0, 0]}
            scale={(selMesh.scale ?? 1) * 1.12}
          />
        ) : null}
      </Scene3D>
      <Box style={{ position: 'absolute', left: 12, bottom: 10 }}>
        <Text fontSize={10} color={accentFor('textFaint')} style={{ fontFamily: 'monospace' }}>drag orbit · wheel zoom · click any mesh (incl. the ground) to inspect</Text>
      </Box>
    </Pressable>
  );
});
