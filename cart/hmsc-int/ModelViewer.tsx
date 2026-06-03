// ModelViewer — a real 3D viewer for a SINGLE object (not the map).
//
// Two things the map preview (IsoPreview) can't do, both delivered here:
//
//  1. No sky / fog. The map preview reuses WorldStatics, which bakes in a
//     <Scene3D.Skybox>. This viewer renders ONLY the object's own meshes
//     (Building3D / Prop / a tile slab) + neutral studio lights under a flat
//     backgroundColor — no Skybox, no Fog — so the model reads on a clean field.
//
//  2. Orbit + zoom by mouse, not buttons. The OrbitCamera rig is a pure solve of
//     (yaw, pitch, dist, zoom); we drive it from input — drag orbits (host global
//     cursor channel, the same seam the divider uses), scroll wheel zooms. The
//     built-in <Scene3D.OrbitControls> is a host-side stub, so the cart owns the
//     camera, exactly like IsoPreview already does — just with live input.

import { useEffect, useRef, useState } from 'react';
import { Box, Pressable, Scene3D, Text } from '@reactjit/primitives';
import { OrbitCamera } from '@reactjit/cameras';
import * as Geometry from '@reactjit/geometries';
import { busOn } from '@reactjit/hooks/useIFTTT';
import type { Building, TileKind, WorldProp } from '../hmsc/design';
import { Building3D } from '../hmsc/render3d/Building';
import { BuildingFacades } from '../hmsc/render3d/BuildingFacades';
import { Prop } from '../hmsc/render3d/Prop';
import { tileKindDefinition } from '../hmsc/world/tileKinds';

const ORBIT_SPEED = 0.4; // degrees per cursor pixel
const ZOOM_STEP = 1.1;

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }

// The scene contents (studio lights + the object's meshes), factored out so a
// palette THUMBNAIL can render the exact same model under a fixed camera. Must
// be a child of a <Scene3D>. No camera / no input here — the wrapper owns those.
// `facades` (default true) bakes the storefront skin onto the walls — skip it
// for tiny thumbnails (massing alone differentiates kinds, and a per-chip facade
// capture is the expensive part / unreadable at that size).
export function ModelScene(props: { building?: Building; prop?: WorldProp; tile?: TileKind; facades?: boolean }) {
  return (
    <>
      {/* studio lighting, no fog — read flat + fully lit */}
      <Scene3D.Fog enabled={false} />
      <Scene3D.AmbientLight color="#ffffff" intensity={0.55} />
      <Scene3D.DirectionalLight direction={[0.5, 1, 0.35]} color="#ffffff" intensity={0.95} />
      {props.building ? <Building3D building={props.building} /> : null}
      {props.building && props.facades !== false ? <BuildingFacades buildings={[props.building]} /> : null}
      {props.prop ? <Prop prop={props.prop} /> : null}
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
  baseDist: number;
  targetY: number;
  background?: string;
  onAdd?: () => void; // when set, a + button drops this object into the place layer
}) {
  const [yaw, setYaw] = useState(35);
  const [pitch, setPitch] = useState(26);
  const [zoom, setZoom] = useState(1);
  const draggingRef = useRef(false);

  // Drag → orbit, driven by the host's global cursor deltas (no per-node move
  // handler → no capture gaps). No-op unless a press is active on the input layer.
  useEffect(() => busOn('system:cursor:move', (e: any) => {
    if (!draggingRef.current) return;
    setYaw((y) => y + Number(e?.dx ?? 0) * ORBIT_SPEED);
    setPitch((p) => clamp(p - Number(e?.dy ?? 0) * ORBIT_SPEED, 4, 88));
  }), []);

  // Wheel up (deltaY > 0) zooms in — matches the 2D canvas zoom convention.
  // Zoom drives the OrbitCamera's effective distance (dist / zoom), so this is a
  // real camera dolly in world space, not a 2D scale of the rendered frame.
  const onScroll = (payload: any) => {
    const dz = Number(payload?.deltaY ?? 0);
    if (!dz) return;
    setZoom((z) => clamp(z * (dz > 0 ? ZOOM_STEP : 1 / ZOOM_STEP), 0.3, 6));
  };

  const reset = () => { setYaw(35); setPitch(26); setZoom(1); };

  return (
    <Box style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={props.background ?? '#0e1622'} showGrid showAxes={false}>
        <OrbitCamera target={[0, props.targetY, 0]} yaw={yaw} pitch={pitch} dist={props.baseDist} zoom={zoom} fov={38} />
        <ModelScene building={props.building} prop={props.prop} tile={props.tile} />
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
