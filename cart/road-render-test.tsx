// road-render-test — a HEADLESS, REAL-GPU proof of what the painted road actually
// renders at named cells, for `rjit shot road-render-test`. req_0833/0835/0837/0838.
// NOT a JS reproduction of the shader (those kept lying that the road resolves fine).
// It mounts the actual WGSL, renders on the GPU, captures the swapchain, and the
// checker (road_render_test.sh) reads the rendered colour back at named cells.
//
// Two routes, over ALL painted chunks of the coastal-town session (so any world cell
// in any chunk can be reached):
//
//   /mesh[/<wx>/<wz>]  (DEFAULT) — the EXACT iso-3D ground path: every painted
//          <Landform> with its groundFormula (HEIGHTFIELD_TILE_BODY evaluated per
//          fragment by framework/gpu/3d.zig) inside a <Scene3D>, from the real
//          IsoStage camera (the rig the editor's iso pane uses; a straight-down
//          camera back-face-culls the ground to black). /wx/wz recentres the view on
//          a world point at a TIGHT zoom so adjacent cells resolve. Path under test.
//
//   /quad[/<wx>/<wz>]  — the same formula as ONE full-window <Effect> quad (2D path,
//          uv 0..1) for the CHUNK containing (wx,wz). The control: proves the DATA is
//          road and the classifier detects asphalt when the formula actually draws it.
//
// Addressing on /mesh: four pure-colour ground FIDUCIALS at ±FID_DX/±FID_DZ around
// the view centre, on the y=0 plane (every road cell tested is at height 0, verified
// offline). The checker finds them and solves the y=0-plane → pixel HOMOGRAPHY, then
// samples each cell. asphalt(fill_road) is dark (~rgb 0.03-0.13); concrete
// (fill_concrete) is light tan (~0.40-0.72). A road cell reading light rendered as
// concrete = the bug. Fiducials/offsets/zoom MUST match road_render_test.sh.

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
import { landformHeightfield } from './hmsc-int/world/landforms/registry';

const CHUNK = 120;

// /diag — a self-contained probe formula: instead of the real material, output what
// the GPU ACTUALLY computes per fragment so the checker can read it back: R = the
// mesh uv.y the fragment receives; G = the cell ROW (cy) it resolves; B = the tile
// KIND it reads at that cell. Run under flat lighting (ambient 1, directional 0) so
// the epilogue passes these through ~unscaled. Decoding at a failing cell tells us
// whether the uv, the cell index, or the kind→material step is where it goes wrong.
const DIAG_FORMULA = `
fn hf_ground_rgb(uv0: vec2f) -> vec3f {
  let cols = i32(D[0]);
  let rows = i32(D[1]);
  let pal = i32(D[2]);
  let cellBase = 3 + pal * 3;
  let cx = clamp(i32(floor(uv0.x * f32(cols))), 0, cols - 1);
  let cy = clamp(i32(floor(uv0.y * f32(rows))), 0, rows - 1);
  let kind = i32(D[cellBase + cy * cols + cx]);
  return vec3f(uv0.y, f32(cy) / f32(rows), f32(max(kind, 0)) / 24.0);
}
`;
// Fiducial offsets from the view centre + the /mesh zoom. Tight zoom so a 1m cell is
// ~tens of px and adjacent cells (e.g. EK52/EK53) never bleed. KEEP IN SYNC with
// road_render_test.sh (FID_DX / FID_DZ / the zoom is implicit in the view span).
const FID_DX = 8;
const FID_DZ = 5;
const MESH_ZOOM = 2;
const DEFAULT_WX = 142.5; // the z~112 bug region, chunk(1,0)
const DEFAULT_WZ = 112.5;

function fiducials(cx: number, cz: number): { color: string; x: number; z: number }[] {
  return [
    { color: '#ff0000', x: cx - FID_DX, z: cz - FID_DZ }, // red
    { color: '#00ff00', x: cx + FID_DX, z: cz - FID_DZ }, // green
    { color: '#0000ff', x: cx + FID_DX, z: cz + FID_DZ }, // blue
    { color: '#00ffff', x: cx - FID_DX, z: cz + FID_DZ }, // cyan
  ];
}

function paintedLandforms(): any[] {
  const world: any = deserializeMap((session as any).payload.world);
  world.focus = new Set([...world.chunks.keys()]); // focus every chunk so all emit
  return floorsFromEditorWorld(world).map((f: any) => floorToLandform(f));
}

function FiducialMarker(props: { color: string; x: number; z: number }) {
  return (
    <Scene3D.Mesh
      geometry={Geometry.Box}
      params={{ width: 1, height: 1, depth: 1 }}
      scale={[3, 0.1, 3]}
      material={props.color}
      position={[props.x, 0.05, props.z]}
    />
  );
}

// Mirror of <Landform>'s mesh but with the DIAG probe formula, for the /diag route.
function DiagLandform(props: { landform: any }) {
  const lf = props.landform;
  const field = landformHeightfield(lf);
  const data = lf.field?.tiles ? heightfieldTileData(lf.field.tiles) : [1, 1, 0, -1];
  return (
    <Scene3D.Mesh
      geometry={Geometry.Heightfield}
      params={{ heights: field.heights, cols: field.cols, rows: field.rows, width: field.width, depth: field.depth, base: field.base }}
      dynamicKey={`diag_${lf.id}`}
      material="#ffffff"
      groundFormula={DIAG_FORMULA}
      groundData={data}
      position={[lf.centerX, lf.baseY, lf.centerZ]}
    />
  );
}

export default function RoadRenderTest() {
  const route = String(callHost('__env_get', '/mesh', 'RJIT_BOOT_ROUTE') ?? '/mesh');
  const seg = route.split('/').filter(Boolean); // e.g. ['mesh','140','52.5']
  const isQuad = seg[0] === 'quad';
  const isDiag = seg[0] === 'diag';
  const WX = seg.length >= 3 && Number.isFinite(Number(seg[1])) ? Number(seg[1]) : DEFAULT_WX;
  const WZ = seg.length >= 3 && Number.isFinite(Number(seg[2])) ? Number(seg[2]) : DEFAULT_WZ;

  const landforms = useMemo(() => paintedLandforms(), []);
  const cam = useMemo(
    () => new IsoStage({ centerX: WX, centerZ: WZ, zoom: MESH_ZOOM, level: 0 }).solve(),
    [WX, WZ],
  );
  const markers = useMemo(() => fiducials(WX, WZ), [WX, WZ]);

  if (!landforms.length) {
    return (
      <Box style={{ width: '100%', height: '100%', backgroundColor: '#ff00ff' }}>
        <Text style={{ color: '#000' }}>NO PAINTED CHUNKS</Text>
      </Box>
    );
  }

  // /quad — the formula as a 2D Effect quad for the chunk containing (WX,WZ). Control.
  if (isQuad) {
    const cx = Math.floor(WX / CHUNK), cz = Math.floor(WZ / CHUNK);
    const lf = landforms.find((l) => l.id === `painted_${cx}_${cz}`);
    const tiles = lf?.field?.tiles ?? null;
    const data = tiles ? heightfieldTileData(tiles) : [1, 1, 0, -1];
    return (
      <Box style={{ width: '100%', height: '100%', backgroundColor: '#ff00ff' }}>
        {tiles ? <Effect shader={HEIGHTFIELD_TILE_SHADER} data={data} style={{ width: '100%', height: '100%' }} /> : null}
      </Box>
    );
  }

  // /diag — same camera as /mesh, but the DIAG probe formula under FLAT lighting
  // (ambient 1, no directional) so the epilogue passes the encoded rgb through
  // unscaled. The checker reuses the /mesh homography (identical camera) to sample.
  if (isDiag) {
    return (
      <Box style={{ width: '100%', height: '100%' }}>
        <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#000000" showAxes={false}>
          <Scene3D.Camera position={cam.pos} target={cam.target} fov={cam.fov} far={4000} />
          <Scene3D.Fog enabled={false} />
          <Scene3D.AmbientLight color="#ffffff" intensity={1.0} />
          {landforms.map((lf) => (
            <DiagLandform key={lf.id} landform={lf} />
          ))}
        </Scene3D>
      </Box>
    );
  }

  // /mesh (DEFAULT) — the iso-3D ground path over every painted chunk, real iso
  // camera centred on (WX,WZ). Neutral bright light so the albedo reads true (asphalt
  // dark / concrete light; lighting only scales — the bug is the albedo). Fog off.
  return (
    <Box style={{ width: '100%', height: '100%' }}>
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#000000" showAxes={false}>
        <Scene3D.Camera position={cam.pos} target={cam.target} fov={cam.fov} far={4000} />
        <Scene3D.Fog enabled={false} />
        <Scene3D.AmbientLight color="#ffffff" intensity={0.9} />
        <Scene3D.DirectionalLight direction={[-0.3, -1, -0.2]} color="#ffffff" intensity={0.35} />
        {landforms.map((lf) => (
          <Landform key={lf.id} landform={lf} />
        ))}
        {markers.map((m) => (
          <FiducialMarker key={m.color} color={m.color} x={m.x} z={m.z} />
        ))}
      </Scene3D>
    </Box>
  );
}
