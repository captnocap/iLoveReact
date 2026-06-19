// studio_paint_probe — PROVES the Studio PIXEL painter (req_1372) end-to-end on a
// REAL cube, through the SAME modules Studio uses: cuboid() → textureizeScene UVs →
// editMeshToGeometry → <Scene3D.Mesh dynamicKey textureKey=PAINT> sampling the RGBA
// <Paintable>, painted via pickFaceUV + stampUV (island-clamped). No box-atlas.
//
// Expect: a cube whose visible face carries a RED base coat with adjacent BLUE and
// GREEN patches, crisp boundary, no seam/leak. Plus a log line confirming the
// raycast pickFaceUV lands on a real uv-mapped face.
//
// Verify:  ./tools/rjit shot studio_paint_probe --out /tmp/sp.png --frames 16

import { useEffect } from 'react';
import { Box, Paintable, Scene3D } from '@reactjit/runtime/primitives';
import { cuboid, editMeshToGeometry } from './hmsc-int/editors/model/editMesh';
import { textureizeScene, DEFAULT_TEXTURE_OPTIONS } from './hmsc-int/editors/model/textureize';
import { makeProjector, orbitalEyeJS, type CameraSnap } from './hmsc-int/editors/model/meshSelect';
import { pickFaceUV, paintUVsNeedRepack, type PaintTarget } from './hmsc-int/editors/model/meshPaint';
import { STUDIO_PAINT_KEY, PAINT_TEX, baseCoat, stampUV, faceIslandPx } from './hmsc-int/editors/model/meshPaintTexture';

const SIZE = 540;
const FOV = 45;

// Real Studio path, simulating req_1375's fix: a cuboid is first textureized the
// DEFAULT way (dedup ON) — all 6 congruent faces collapse to ONE shared island, so
// painting one would paint all six (the bug). paintUVsNeedRepack detects that, and
// we re-pack dedup OFF so every face owns a UNIQUE island. Stamping one face then
// stays on that one face only.
const baseCube = cuboid(2, 2, 2);
const shared = textureizeScene([baseCube], { ...DEFAULT_TEXTURE_OPTIONS, type: 'solid', color: '#c8ccd2' }, 16, 1024).meshes[0];
const sharedFlag = paintUVsNeedRepack([shared]); // expect TRUE (dedup collapsed faces)
const packed = textureizeScene([shared], { ...DEFAULT_TEXTURE_OPTIONS, dedupIslands: false, combineIslands: false, rearrangeUV: true, type: 'solid', color: '#c8ccd2' }, 16, 1024);
const cube = packed.meshes[0];
const uniqueFlag = paintUVsNeedRepack([cube]); // expect FALSE (each face its own island)
const geom = editMeshToGeometry(cube);
const cam: CameraSnap = { eye: orbitalEyeJS([0, 0, 0], 35, 22, 6), target: [0, 0, 0], fov: FOV, aspect: 1, w: SIZE, h: SIZE, near: 0.02 };

// face center (world) for a loop
function faceCenter(fi: number): [number, number, number] {
  const f = cube.faces[fi];
  let x = 0, y = 0, z = 0;
  for (const vi of f.loop) { const v = cube.verts[vi]; x += v[0]; y += v[1]; z += v[2]; }
  const n = f.loop.length;
  return [x / n, y / n, z / n];
}

export default function StudioPaintProbe() {
  useEffect(() => {
    (globalThis as any).__hostLog?.(0, `[probe] dedup-shared needsRepack=${sharedFlag} (expect true); after dedup-off needsRepack=${uniqueFlag} (expect false)`);
    const targets: PaintTarget[] = [{ partId: 'cube', mesh: cube, lift: 0 }];
    const project = makeProjector(cam);
    // pick a face whose projected center is well inside the viewport and front-facing
    let chosen = -1;
    for (let fi = 0; fi < cube.faces.length; fi += 1) {
      const c = project(faceCenter(fi));
      if (!c.front) continue;
      if (c.x > SIZE * 0.2 && c.x < SIZE * 0.8 && c.y > SIZE * 0.2 && c.y < SIZE * 0.8) {
        const hit = pickFaceUV(targets, cam, c.x, c.y);
        if (hit) { chosen = hit.faceIndex; (globalThis as any).__hostLog?.(0, `[probe] pickFaceUV hit face ${hit.faceIndex} uv=(${hit.u.toFixed(3)},${hit.v.toFixed(3)})`); break; }
      }
    }
    const fi = chosen >= 0 ? chosen : 0;
    const island = faceIslandPx(cube, fi);
    // two UVs inside this face's island, ADJACENT (discs touch) — the no-seam test.
    const uvAt = (fx: number, fy: number): [number, number] => {
      if (!island) return [0.5, 0.5];
      return [(island.x0 + (island.x1 - island.x0) * fx) / PAINT_TEX, (island.y0 + (island.y1 - island.y0) * fy) / PAINT_TEX];
    };
    const [bu, bv] = uvAt(0.36, 0.5);
    const [gu, gv] = uvAt(0.64, 0.5);
    const islandPx = island ? Math.min(island.x1 - island.x0, island.y1 - island.y0) : 64;
    const r = Math.max(6, islandPx * 0.22);

    let n = 0;
    const id = setInterval(() => {
      baseCoat('#d8222a');                 // red base
      stampUV(bu, bv, '#1f6fe6', r, island); // blue, left  — adjacent to →
      stampUV(gu, gv, '#33d36a', r, island); // green, right
      if (++n > 30) clearInterval(id);
    }, 0);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#0b0d13', alignItems: 'center', justifyContent: 'center' }}>
      <Box style={{ width: SIZE, height: SIZE }}>
        <Paintable id={STUDIO_PAINT_KEY} w={PAINT_TEX} h={PAINT_TEX} rgba />
        <Scene3D style={{ position: 'absolute', left: 0, top: 0, width: SIZE, height: SIZE }}>
          <Scene3D.Camera position={cam.eye} target={[0, 0, 0]} fov={FOV} />
          <Scene3D.AmbientLight color="#ffffff" intensity={1} />
          <Scene3D.Fog enabled={false} />
          <Scene3D.Mesh geometry={{ id: 'probe-cube', generate: () => geom, defaults: {} }} dynamicKey="probe.cube~1" material="#ffffff" textureKey={STUDIO_PAINT_KEY} position={[0, 0, 0]} />
        </Scene3D>
      </Box>
    </Box>
  );
}
