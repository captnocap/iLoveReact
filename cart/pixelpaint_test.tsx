// pixelpaint_test — PROOF that the RGBA paintable (req_1372 Phase A) paints
// N flat colours onto a 3D mesh texture with NO boxes / NO StaticSurface.
//
// A box mesh samples an RGBA <Paintable> via textureKey. We base-coat it red
// then stamp a blue disc and a green disc, adjacent. Expect: a red box face
// with a crisp blue blob and a crisp green blob, no seam/blend between them.
//
// Verify:  ./tools/rjit shot pixelpaint_test --out /tmp/pp.png --frames 8
//   then inspect pixels — center-left should be blue, center-right green,
//   surround red. (Lit with full ambient + white material so texture ≈ pixel.)

import { useEffect } from 'react';
import { Box, Paintable, Scene3D } from '@reactjit/runtime/primitives';
import { usePaintable } from '@reactjit/runtime/hooks/usePaintable';

const SIZE = 512;
const TEX = 256;
const Geom = { box: (require('@reactjit/geometries') as any).Box };

export default function PixelPaintTest() {
  const pt = usePaintable({ w: TEX, h: TEX });

  useEffect(() => {
    // The <Paintable> CREATE drains next frame, so brush ops dropped now would
    // miss the texture. Re-stamp every 60ms for the first second: ops are
    // idempotent (same colour, same place), so once the texture exists it
    // settles to the same picture. A real painter fires on mouse events.
    let n = 0;
    const id = setInterval(() => {
      pt.paint.clearColor(0.85, 0.12, 0.18, 1); // base coat: red
      // round hard disc: kind 0, angle 0, aspect 1, hardness 1, flow 1
      pt.paint.brushColor(96, 128, 34, 0.15, 0.45, 0.95, 0, 0, 1, 1, 1, 0, 0); // blue, left
      pt.paint.brushColor(160, 128, 34, 0.25, 0.78, 0.35, 0, 0, 1, 1, 1, 0, 0); // green, right
      if (++n > 30) clearInterval(id);
    }, 0); // 0ms: due every pump (headless renders frames faster than wall-ms)
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#0b0d13', alignItems: 'center', justifyContent: 'center' }}>
      <Box style={{ width: SIZE, height: SIZE }}>
        {/* the paintable owns the GPU texture; the mesh samples it by key */}
        <Paintable id={pt.id} w={TEX} h={TEX} rgba />
        <Scene3D style={{ position: 'absolute', left: 0, top: 0, width: SIZE, height: SIZE }}>
          <Scene3D.Camera position={[2.4, 1.6, 2.8]} target={[0, 0, 0]} fov={45} />
          <Scene3D.AmbientLight color="#ffffff" intensity={1} />
          <Scene3D.Fog enabled={false} />
          <Scene3D.Mesh geometry={Geom.box} params={{ width: 2, height: 2, depth: 2 }} material={{ color: '#ffffff' }} textureKey={pt.id} position={[0, 0, 0]} />
        </Scene3D>
      </Box>
    </Box>
  );
}
