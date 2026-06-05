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
// Like SceneSurface, orbit state lives HERE and the camera is a plain solved
// <Scene3D.Camera> (not an OrbitCamera rig), so the SAME solve drives both render
// and pick — click selection stays exact. The model is drawn through ModelScene
// (the real Building3D / facades / Prop), and the offscreen texture captures are
// mounted as 2D siblings so an applied texture actually bakes and shows.

import { memo, useMemo, useRef, useState } from 'react';
import { Box, Pressable, Scene3D, Text } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import { solveCamera, CAMERAS, type Rect, type Vec3 } from '@reactjit/cameras';
import { pickMesh } from './assist3d/picking';
import type { Building, WorldProp } from '../hmsc/design';
import { buildingParts } from '../hmsc/render3d/buildingParts';
import { propParts } from '../hmsc/render3d/propParts';
import type { Part } from '../hmsc/render3d/parts';
import { BuildingSurfaceCaptures } from '../hmsc/render3d/BuildingFacades';
import { PropSurfaceCaptures } from '../hmsc/render3d/PropCaptures';
import { WorldPartCaptures, BuildingTexturedFaces } from '../hmsc/render3d/PartCaptures';
import { ModelScene } from './ModelViewer';
import { accentFor } from './studio.cls';

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
  const [yaw, setYaw] = useState(35);
  const [pitch, setPitch] = useState(26);
  const [dist, setDist] = useState(props.baseDist);

  const rectRef = useRef<Rect>({ x: 0, y: 0, width: 800, height: 600 });
  const dragRef = useRef<{ x: number; y: number; dist: number } | null>(null);

  const parts = useMemo<Part[]>(
    () => (building ? buildingParts(building) : prop ? propParts(prop) : []),
    [building, prop],
  );

  const solved = useMemo(
    () => solveCamera(CAMERAS.Orbit, { target: [0, props.targetY, 0] as Vec3, yaw, pitch, dist, zoom: 1, fov: 38 }),
    [yaw, pitch, dist, props.targetY],
  );

  const onDown = (e: any) => { dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0), dist: 0 }; };
  const onMove = (e: any) => {
    const d = dragRef.current; if (!d) return;
    const nx = Number(e?.x ?? 0), ny = Number(e?.y ?? 0);
    const dx = nx - d.x, dy = ny - d.y;
    d.dist += Math.abs(dx) + Math.abs(dy); d.x = nx; d.y = ny;
    setYaw((v) => v + dx * 0.4);
    setPitch((v) => clamp(v - dy * 0.3, 6, 85));
  };
  const onUp = (e: any) => {
    const d = dragRef.current; dragRef.current = null;
    if (!d || d.dist >= 6) return;                       // a drag, not a tap
    const r = rectRef.current;
    const sx = Number(e?.x ?? 0) - r.x, sy = Number(e?.y ?? 0) - r.y;
    const hit = pickMesh(sx, sy, r, solved, parts);
    props.onPick(hit >= 0 ? parts[hit].id : null);
  };
  const onWheel = (e: any) => {
    const dy = Number(e?.deltaY ?? e?.dy ?? 0);
    setDist((v) => clamp(v + (dy > 0 ? 1 : -1) * Math.max(1, props.baseDist * 0.08), 3, props.baseDist * 3));
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
          <Scene3D.Camera position={solved.pos} target={solved.target} fov={solved.fov} />
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
