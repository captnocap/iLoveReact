// road-render-test — a HEADLESS, REAL-GPU proof of what the painted road actually
// renders at named cells, for `rjit shot road-render-test`. req_0833 / req_0835:
// "write a test that says at these exact points, even if the data says it is
// supposed to render a road, that it is not rendering a road" — and it must be the
// SAME path the iso 3D shows (the mesh, not a 2D quad), so it FAILS.
//
// Two routes, two paths, one shared chunk(1,0) tile field from the coastal-town
// session (the map the user is debugging):
//
//   /mesh  (DEFAULT) — renders the EXACT iso-3D ground component: <Landform> with
//          its groundFormula path (HEIGHTFIELD_TILE_BODY evaluated per-fragment by
//          framework/gpu/3d.zig on the heightfield mesh) inside a <Scene3D>, from
//          the REAL iso camera (IsoStage — the same rig the editor's iso pane uses,
//          which renders the ground; a straight-down camera back-face-culls it to
//          black). THIS is where the road renders as concrete — the failing test.
//
//   /quad  — the same formula as ONE full-window <Effect> quad (the 2D editor/
//          capture path). The formula renders the road correctly here, so /quad
//          PASSES — the quad-vs-mesh split bisects the bug to the MESH path.
//
// Deterministic addressing WITHOUT trusting camera internals: /mesh draws four
// pure-colour FIDUCIAL markers on the ground plane (y≈0) at known world (x,z)
// forming a quad around the road sample region. The checker (road_render_test.sh)
// finds their pixels and solves the ground-plane → pixel HOMOGRAPHY (the iso view of
// a flat plane is a homography; 4 points fix it exactly), then samples each named
// cell's ground colour. asphalt is dark (fill_road ≈ rgb 0.03–0.13); concrete is
// light tan (fill_concrete ≈ 0.40–0.72). A road cell that reads light rendered as
// concrete = the bug, on real pixels.

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

// The four ground fiducials, a quad around the road sample region (road band is
// world x≈137–143, test rows z 111–114). KEEP IN SYNC with road_render_test.sh.
const MARKERS: { color: string; x: number; z: number }[] = [
  { color: '#ff0000', x: 125, z: 105 }, // red
  { color: '#00ff00', x: 160, z: 105 }, // green
  { color: '#0000ff', x: 160, z: 122 }, // blue
  { color: '#00ffff', x: 125, z: 122 }, // cyan
];
// Camera centred on the fiducial-quad centroid; zoom 1 = BASE_DIST 90m out at the
// narrow iso FOV, framing the ~35×17m region.
const VIEW_CX = 142.5;
const VIEW_CZ = 113.5;

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
  const lf = useMemo(() => paintedChunk10(), []);
  const tiles = lf?.field?.tiles ?? null;
  const data = useMemo(() => (tiles ? heightfieldTileData(tiles) : [1, 1, 0, -1]), [tiles]);
  const cam = useMemo(() => new IsoStage({ centerX: VIEW_CX, centerZ: VIEW_CZ, zoom: 1, level: 0 }).solve(), []);

  if (!tiles) {
    return (
      <Box style={{ width: '100%', height: '100%', backgroundColor: '#ff00ff' }}>
        <Text style={{ color: '#000' }}>NO CHUNK (1,0)</Text>
      </Box>
    );
  }

  // /quad — the formula as a 2D Effect quad. uv↔cell is exactly linear; the road
  // renders correctly here (PASS). Comparison path for the bisection.
  if (route.startsWith('/quad')) {
    return (
      <Box style={{ width: '100%', height: '100%' }}>
        <Effect shader={HEIGHTFIELD_TILE_SHADER} data={data} style={{ width: '100%', height: '100%' }} />
      </Box>
    );
  }

  // /mesh (DEFAULT) — the iso-3D ground path: <Landform> groundFormula mesh, from the
  // real iso camera. Neutral bright light so the albedo reads true (asphalt dark /
  // concrete light; lighting only scales — the bug is the albedo). Fog off.
  return (
    <Box style={{ width: '100%', height: '100%' }}>
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#000000" showAxes={false}>
        <Scene3D.Camera position={cam.pos} target={cam.target} fov={cam.fov} far={4000} />
        <Scene3D.Fog enabled={false} />
        <Scene3D.AmbientLight color="#ffffff" intensity={0.9} />
        <Scene3D.DirectionalLight direction={[-0.3, -1, -0.2]} color="#ffffff" intensity={0.35} />
        <Landform landform={lf} />
        {MARKERS.map((m) => (
          <FiducialMarker key={m.color} color={m.color} x={m.x} z={m.z} />
        ))}
      </Scene3D>
    </Box>
  );
}
