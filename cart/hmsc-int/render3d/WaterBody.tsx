import { memo, useMemo } from 'react';
import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { WaterBody as WaterBodyData } from '../design';
import { waterFlatHeights } from '../game/kinds/waterBodies';

// The renderer for an authored body of water (world/water). A body is FACTORS —
// a footprint + one surface level — and renders as ONE STATIC heightfield mesh: a
// flat top surface at surfaceY plus the heightfield's own perimeter skirt dropped
// to the basin floor (the body's translucent VOLUME — wade in and the water
// surrounds you; 'disc' rounds off via the skirt).
//
// All MOTION and LOOK live in the fixed host "~water~" pipeline (framework/gpu:
// shaders.water_wgsl + g_water_pipeline), routed by the textureKey sentinel — the
// twin of grass's "~grass~". The host animates a multi-octave wave field from its
// own S.time clock and paints the deep/shallow gradient + foam + Bayer-dither
// halftone (the dither IS the see-through water, so the mesh is OPAQUE — a
// translucent mesh would divert to the transparent pass and miss the pipeline).
// Because framework/gpu/3d.zig is shared, /test and the compiled no-V8 loader
// render water identically (GUIDING_LIGHT: the DATA is just "a body lives here";
// the look is the dumb fixed system). The mesh is static — it interns once and
// never re-bakes per frame, unlike the old JS per-tick ripple.

const WaterBodyMesh = memo(function WaterBodyMesh(props: { body: WaterBodyData }) {
  const b = props.body;
  const centerX = b.x + b.width / 2;
  const centerZ = b.z + b.depth / 2;
  // FLAT still-water grid, baked once. A painted body from the water layer ships
  // its authored field verbatim; a parametric body builds a footprint grid. Both
  // yield {cols,rows,heights,base} — the host waves ride this flat surface.
  const field = useMemo(() => {
    if (b.field) {
      const { cols, rows, cell, heights, base } = b.field;
      return { cols, rows, heights, base, width: (cols - 1) * cell, depth: (rows - 1) * cell };
    }
    const f = waterFlatHeights(b.shape, b.width, b.depth, b.surfaceY);
    return { ...f, width: b.width, depth: b.depth };
  }, [b.field, b.shape, b.width, b.depth, b.surfaceY]);
  // Opaque (a < 1 would route to the transparent pass and skip the water pipeline).
  // inst_color is ignored by the water shader, which carries the ONE water look.
  const material = useMemo(() => ({ color: '#2f7fa8', opacity: 1 }), []);
  return (
    <Scene3D.Mesh
      geometry={Geometry.Heightfield}
      params={{ heights: field.heights, cols: field.cols, rows: field.rows, width: field.width, depth: field.depth, base: field.base }}
      dynamicKey={`water_${b.id}~0`}
      material={material}
      textureKey="~water~"
      position={[centerX, 0, centerZ]}
    />
  );
});

// Renders every authored body. No clock — the host pipeline owns wave time, so
// ticking a body never re-renders the static world around it.
export const WaterBodies = memo(function WaterBodies(props: { bodies: readonly WaterBodyData[] }) {
  return (
    <>
      {props.bodies.map((body) => (
        <WaterBodyMesh key={body.id} body={body} />
      ))}
    </>
  );
});
