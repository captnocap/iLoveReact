// road-render-test — a HEADLESS, REAL-GPU proof of what the painted road actually
// renders at named cells, for `rjit shot road-render-test`. req_0833 / req_0835 /
// req_0837. NOT a JS reproduction of the shader (those kept lying that the road
// resolves fine). It mounts the actual WGSL, renders on the GPU, captures the
// swapchain, and the checker reads the rendered colour back at named cells.
//
// Two routes, one shared chunk(1,0) tile field from the coastal-town session:
//
//   /mesh[/<cx>/<cz>]  (DEFAULT) — the EXACT iso-3D ground path: <Landform> with its
//          groundFormula (HEIGHTFIELD_TILE_BODY evaluated per-fragment by
//          framework/gpu/3d.zig on the heightfield mesh) inside a <Scene3D>, from the
//          real IsoStage camera (the rig the editor's iso pane uses — a straight-down
//          camera back-face-culls the ground to black). Optional /cx/cz route
//          segments recentre the view on a region so distant cells can be sampled at
//          resolution. THIS is the path under test.
//
//   /quad  — the same formula as ONE full-window <Effect> quad (2D path, uv 0..1
//          across the image). The formula renders the road correctly here, so /quad
//          is the control that proves the DATA is road and the classifier detects
//          asphalt when it is actually drawn.
//
// Deterministic addressing on /mesh: four pure-colour ground FIDUCIALS at a fixed
// offset (±FID_DX, ±FID_DZ) around the view centre, on the ground plane (y≈0). The
// checker finds them and solves the ground-plane → pixel HOMOGRAPHY, then samples
// each cell. asphalt(fill_road) is dark (~rgb 0.03-0.13); concrete(fill_concrete) is
// light tan (~0.40-0.72). A road cell that reads light rendered as concrete = the
// bug. Fiducials and offsets MUST match road_render_test.sh.

import { useMemo } from 'react';
import { Box, Effect, Scene3D, Text } from '@reactjit/runtime/primitives';
import * as Geometry from '@reactjit/geometries';
import { callHost } from '@reactjit/ffi';
import session from './hmsc-int/sessions/coastal-town.session.json';
import { deserializeMap } from './hmsc-int/mapStore';
import { floorsFromEditorWorld, floorToLandform } from './hmsc-int/chunkFloor';
import { HEIGHTFIELD_TILE_SHADER, heightfieldTileData } from './hmsc-int/render3d/heightfieldSurface';
import { Landform } from './hmsc-int/render3d/Landform';
import { IsoStage } from './hmsc-int/isoStage';

// Fiducial offsets from the view centre (a 35×17m ground quad). KEEP IN SYNC with
// road_render_test.sh (FID_DX / FID_DZ).
const FID_DX = 17.5;
const FID_DZ = 8.5;
const DEFAULT_CX = 142.5;
const DEFAULT_CZ = 113.5;

function fiducials(cx: number, cz: number): { color: string; x: number; z: number }[] {
  return [
    { color: '#ff0000', x: cx - FID_DX, z: cz - FID_DZ }, // red
    { color: '#00ff00', x: cx + FID_DX, z: cz - FID_DZ }, // green
    { color: '#0000ff', x: cx + FID_DX, z: cz + FID_DZ }, // blue
    { color: '#00ffff', x: cx - FID_DX, z: cz + FID_DZ }, // cyan
  ];
}

function paintedChunk10() {
  const world: any = deserializeMap((session as any).payload.world);
  world.focus = new Set([...world.chunks.keys()]); // focus every chunk so (1,0) emits
  const floors = floorsFromEditorWorld(world);
  const f = floors.find((x: any) => x.cx === 1 && x.cz === 0);
  return f ? (floorToLandform(f) as any) : null;
}

function FiducialMarker(props: { color: string; x: number; z: number }) {
  return (
    <Scene3D.Mesh
      geometry={Geometry.Box}
      params={{ width: 1, height: 1, depth: 1 }}
      scale={[4, 0.1, 4]}
      material={props.color}
      position={[props.x, 0.05, props.z]}
    />
  );
}

export default function RoadRenderTest() {
  const route = String(callHost('__env_get', '/mesh', 'RJIT_BOOT_ROUTE') ?? '/mesh');
  const seg = route.split('/').filter(Boolean); // e.g. ['mesh','139','11']
  const isQuad = seg[0] === 'quad';
  const CX = seg.length >= 3 && Number.isFinite(Number(seg[1])) ? Number(seg[1]) : DEFAULT_CX;
  const CZ = seg.length >= 3 && Number.isFinite(Number(seg[2])) ? Number(seg[2]) : DEFAULT_CZ;

  const lf = useMemo(() => paintedChunk10(), []);
  const tiles = lf?.field?.tiles ?? null;
  const data = useMemo(() => (tiles ? heightfieldTileData(tiles) : [1, 1, 0, -1]), [tiles]);
  const cam = useMemo(() => new IsoStage({ centerX: CX, centerZ: CZ, zoom: 1, level: 0 }).solve(), [CX, CZ]);
  const markers = useMemo(() => fiducials(CX, CZ), [CX, CZ]);

  if (!tiles) {
    return (
      <Box style={{ width: '100%', height: '100%', backgroundColor: '#ff00ff' }}>
        <Text style={{ color: '#000' }}>NO CHUNK (1,0)</Text>
      </Box>
    );
  }

  // /quad — the formula as a 2D Effect quad (control). uv↔cell linear.
  if (isQuad) {
    return (
      <Box style={{ width: '100%', height: '100%' }}>
        <Effect shader={HEIGHTFIELD_TILE_SHADER} data={data} style={{ width: '100%', height: '100%' }} />
      </Box>
    );
  }

  // /mesh (DEFAULT) — the iso-3D ground path: <Landform> groundFormula mesh, real iso
  // camera. Neutral bright light so the albedo reads true (asphalt dark / concrete
  // light; lighting only scales — the bug is the albedo). Fog off.
  return (
    <Box style={{ width: '100%', height: '100%' }}>
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#000000" showAxes={false}>
        <Scene3D.Camera position={cam.pos} target={cam.target} fov={cam.fov} far={4000} />
        <Scene3D.Fog enabled={false} />
        <Scene3D.AmbientLight color="#ffffff" intensity={0.9} />
        <Scene3D.DirectionalLight direction={[-0.3, -1, -0.2]} color="#ffffff" intensity={0.35} />
        <Landform landform={lf} />
        {markers.map((m) => (
          <FiducialMarker key={m.color} color={m.color} x={m.x} z={m.z} />
        ))}
      </Scene3D>
    </Box>
  );
}
