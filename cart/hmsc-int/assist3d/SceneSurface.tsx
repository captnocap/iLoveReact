// assist3d/SceneSurface — the center 3D surface, isolated so dragging it never
// re-renders the chat/transcript/inspector around it.
//
// Two reasons this is its own memo'd component (the IsoPreview lesson):
//   1. Orbit input state lives HERE, so a drag never re-renders the parent route
//      with its streaming chat log.
//   2. The renderer camera is driven by the V23 native per-node controller.
//      Selection keeps a separate shadow solve so click picking stays exact.
//
// The scene meshes are memoized on `scene` identity, so orbiting never re-ships
// vertices across the bridge. The floor is the viewer's reference grid (showGrid)
// — NOT a scene mesh: it's stage chrome, so it isn't in the tree, isn't selectable,
// and never ships on export. The scene contains only the model's real objects.

import { memo, useEffect, useMemo, useRef } from 'react';
import { Box, Pressable, Scene3D, Text } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import { accentFor } from '../studio.cls';
import { GAME_CAMERA, GAME_NATIVE_CAMERA } from '../game';
import { pickMesh } from './picking';
import type { SceneSpec } from './scene';

type Vec3 = [number, number, number];
type Rect = { x: number; y: number; width: number; height: number };

const VIEW_TARGET: Vec3 = [0, 1, 0];

export const SceneSurface = memo(function SceneSurface(props: {
  scene: SceneSpec;
  selected: number | null;
  onPick: (index: number | null) => void;
}) {
  const { scene, selected } = props;
  const rectRef = useRef<Rect>({ x: 0, y: 0, width: 800, height: 700 });
  const dragRef = useRef<{ x: number; y: number; dist: number } | null>(null);
  const lookRef = useRef({ yaw: 38, pitch: 28 });
  const distRef = useRef(12);
  const cameraRef = useRef<any>(null);
  const cameraCtlRef = useRef<ReturnType<typeof GAME_NATIVE_CAMERA.forNode> | null>(null);

  const solveShadow = () => GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, {
    target: VIEW_TARGET,
    yaw: lookRef.current.yaw,
    pitch: lookRef.current.pitch,
    dist: distRef.current,
    zoom: 1,
    fov: 52,
  });
  const shadowCamRef = useRef(solveShadow());
  const bootCam = shadowCamRef.current;

  const sendOrbit = () => {
    cameraCtlRef.current?.setOrbit({
      target: VIEW_TARGET,
      yaw: lookRef.current.yaw,
      pitch: lookRef.current.pitch,
      distance: distRef.current,
      zoom: 1,
      fov: 52,
    });
  };

  useEffect(() => {
    const ctl = GAME_NATIVE_CAMERA.forNode(cameraRef.current);
    cameraCtlRef.current = ctl;
    ctl.setMode('orbit');
    sendOrbit();
    return () => {
      ctl.disable();
      cameraCtlRef.current = null;
    };
  }, []);

  const onDown = (e: any) => { dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0), dist: 0 }; };
  const onMove = (e: any) => {
    const d = dragRef.current; if (!d) return;
    const nx = Number(e?.x ?? 0), ny = Number(e?.y ?? 0);
    const dx = nx - d.x, dy = ny - d.y;
    d.dist += Math.abs(dx) + Math.abs(dy); d.x = nx; d.y = ny;
    const look = lookRef.current;
    const nextYaw = look.yaw + dx * 0.4;
    const nextPitch = Math.max(6, Math.min(85, look.pitch - dy * 0.3));
    cameraCtlRef.current?.setInputDeltas(nextYaw - look.yaw, nextPitch - look.pitch);
    lookRef.current = { yaw: nextYaw, pitch: nextPitch };
    shadowCamRef.current = solveShadow();
  };
  const onUp = (e: any) => {
    const d = dragRef.current; dragRef.current = null;
    if (!d || d.dist >= 6) return;                       // a drag, not a tap
    const r = rectRef.current;
    const sx = Number(e?.x ?? 0) - r.x, sy = Number(e?.y ?? 0) - r.y;
    const hit = pickMesh(sx, sy, r, shadowCamRef.current, scene.meshes);
    props.onPick(hit >= 0 ? hit : null);
  };
  const onWheel = (e: any) => {
    const dy = Number(e?.deltaY ?? e?.dy ?? 0);
    distRef.current = Math.max(3, Math.min(40, distRef.current + (dy > 0 ? 1 : -1) * 1.1));
    sendOrbit();
    shadowCamRef.current = solveShadow();
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
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={scene.background} showGrid={true} showAxes={false}>
        <Scene3D.Camera nativeCamera ref={cameraRef} position={bootCam.pos} target={bootCam.target} fov={bootCam.fov} />
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
        <Text fontSize={10} color={accentFor('textFaint')} style={{ fontFamily: 'monospace' }}>drag orbit · wheel zoom · click a mesh to inspect · grid is viewer chrome, not exported</Text>
      </Box>
    </Pressable>
  );
});
