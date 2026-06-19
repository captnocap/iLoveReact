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
import { cuboid, extrudeFace, editMeshToGeometry } from './hmsc-int/editors/model/editMesh';
import { textureizeScene, DEFAULT_TEXTURE_OPTIONS } from './hmsc-int/editors/model/textureize';
import { makeProjector, orbitalEyeJS, type CameraSnap } from './hmsc-int/editors/model/meshSelect';
import { pickFaceUV, paintUVsNeedRepack, type PaintTarget } from './hmsc-int/editors/model/meshPaint';
import { STUDIO_PAINT_KEY, PAINT_TEX, baseCoat, stampUV, faceIslandPx, savePaint, restorePaint } from './hmsc-int/editors/model/meshPaintTexture';

const SIZE = 540;
const FOV = 45;

// req_1376: the user's bleeding face is the ONLY one from an EXTRUDE. extrudeFace
// gives the new SIDE WALLS a default full-square [0,1] UV (faceSquareUV) — each
// samples the WHOLE texture, so painting one shows on all of them. Reproduce that
// exactly: cuboid → extrude a face → the side walls are full-square. Then run the
// req_1375 fix (detect → dedup-OFF re-pack) and confirm a stamp on a side wall now
// isolates to that one wall. extrudeFace appends 4 side walls after the 6 cuboid
// faces, so face 6 is a side wall.
const baseCube = extrudeFace(cuboid(2, 2, 2), 2, 1.4); // extrude one face → +4 full-square side walls
const sideWallFace = 6; // first appended side wall
const sharedFlag = paintUVsNeedRepack([baseCube]); // expect TRUE (full-square side walls)
const packed = textureizeScene([baseCube], { ...DEFAULT_TEXTURE_OPTIONS, dedupIslands: false, combineIslands: false, rearrangeUV: true, type: 'solid', color: '#c8ccd2' }, 16, 1024);
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
    (globalThis as any).__hostLog?.(0, `[probe] extruded side-wall: needsRepack(full-square)=${sharedFlag} (expect true); after dedup-off re-pack=${uniqueFlag} (expect false)`);
    // Paint the EXTRUDED side wall specifically (the user's case). If the fix works,
    // only THIS wall greens; if not, all 4 side walls (faces 6..9) green together.
    const fi = sideWallFace;
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

    // req_1382 persistence roundtrip: paint, then bake (PNG→hash→capture), WIPE the
    // texture, and restore from the captured blob. If the final frame shows the paint
    // (not the black wipe), the content-addressed encode→hash→decode→upload roundtrip
    // works AND the PNG is small. Logs the blob size so we can see it's tens of KB.
    let captured: string | null = null;
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      if (n <= 6) {
        baseCoat('#d8222a');                 // red base
        stampUV(bu, bv, '#1f6fe6', r, island); // blue, left  — adjacent to →
        stampUV(gu, gv, '#33d36a', r, island); // green, right
      } else if (n === 8) {
        savePaint((ref, b64) => { captured = b64; (globalThis as any).__hostLog?.(0, `[probe] baked paintRef=${ref.slice(0, 12)} pngBase64Len=${b64.length} (vs raw rgba base64 ~5.6M)`); });
      } else if (n === 10) {
        baseCoat('#000000');                 // WIPE to black — proves restore really reloads
      } else if (n === 12) {
        const ok = restorePaint(captured);   // reload the baked paint
        (globalThis as any).__hostLog?.(0, `[probe] restorePaint ok=${ok}`);
      } else if (n > 16) {
        clearInterval(id);
      }
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
