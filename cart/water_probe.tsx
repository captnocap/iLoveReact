// water_probe — isolated proof of the stylized "~water~" host pipeline
// (framework/gpu: shaders.water_wgsl + g_water_pipeline). One flat water
// heightfield over a sand floor, a low oblique camera so the FBM waves, the
// deep/shallow gradient, the foam, and the Bayer-dither halftone all read.
// `rjit shot water_probe` captures the swapchain headless.
import { useMemo } from 'react';
import { Box, Scene3D } from '@reactjit/runtime/primitives';
import * as Geometry from '@reactjit/geometries';
import { waterFlatHeights } from './hmsc-int/game/kinds/waterBodies';

const W = 80;
const D = 80;
const SURFACE_Y = 2;

export default function WaterProbe() {
  const field = useMemo(() => waterFlatHeights('rect', W, D, SURFACE_Y), []);
  return (
    <Box style={{ width: '100%', height: '100%' }}>
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#7fb4e6" showAxes={false}>
        {/* Low oblique camera skimming the surface, like the beach-viewer shot. */}
        <Scene3D.Camera position={[0, 14, 64]} target={[0, 1, 0]} fov={50} far={4000} />
        <Scene3D.Fog enabled={false} />
        <Scene3D.AmbientLight color="#ffffff" intensity={0.7} />
        <Scene3D.DirectionalLight direction={[-0.4, -1, -0.3]} color="#fff6e0" intensity={0.6} />
        {/* Sand bed under the water — the dither holes reveal it as "depth". */}
        <Scene3D.Mesh
          geometry={Geometry.Box}
          params={{ width: W + 20, height: 2, depth: D + 20 }}
          material="#d8c79a"
          position={[0, -1, 0]}
        />
        {/* The water body — static flat heightfield, the host animates the waves. */}
        <Scene3D.Mesh
          geometry={Geometry.Heightfield}
          params={{ heights: field.heights, cols: field.cols, rows: field.rows, width: W, depth: D, base: field.base }}
          dynamicKey="water_probe~0"
          material={{ color: '#2f7fa8', opacity: 1 }}
          textureKey="~water~"
          position={[0, 0, 0]}
        />
      </Scene3D>
    </Box>
  );
}
