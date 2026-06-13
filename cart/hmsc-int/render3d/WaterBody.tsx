import { memo } from 'react';
import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { WaterBody as WaterBodyData } from '../design';

// The renderer for an authored body of water (world/water). A body is FACTORS —
// a footprint + one surface level — so the render is the dumb consequence: a thin
// translucent slab whose TOP face sits exactly at surfaceY over the footprint.
// The terrain bed (a flat region or a heightfield landform) is drawn underneath
// by WorldStatics, so the depth you SEE is the real geometry between the bed and
// this surface — dig the bed deeper and the same body reads deeper, no stored
// depth grid. Translucent (opacity routes through 3d.zig's back-to-front
// transparent pass — the same path Glass uses), so the bed shows through.
//
// rect → a Box footprint; disc → a flat Cylinder (the inscribed ellipse, drawn as
// a regular cylinder scaled to the footprint so an oval pond reads round).

// Slab thinness — just enough to give the waterline an edge without the bottom
// face poking through a shallow bed.
const WATER_SLAB_THICKNESS_METERS = 0.12;

// Cool tinted water. Opacity < 1 sends it through the transparent pass; the bed
// (and anything wading in it) reads through the surface as submerged depth.
const WATER_COLOR = '#2f7fa8';
const WATER_OPACITY = 0.6;

export const WaterBodyMesh = memo(function WaterBodyMesh(props: { body: WaterBodyData }) {
  const b = props.body;
  const centerX = b.x + b.width / 2;
  const centerZ = b.z + b.depth / 2;
  const topY = b.surfaceY - WATER_SLAB_THICKNESS_METERS / 2;
  const material = { color: WATER_COLOR, opacity: WATER_OPACITY };
  if (b.shape === 'disc') {
    // A unit cylinder (radius 1, height 1) scaled to the footprint — width/depth
    // become the two ellipse diameters, so a non-square footprint reads as an oval.
    return (
      <Scene3D.Mesh
        geometry={Geometry.Cylinder}
        params={{ radius: 0.5, height: 1, segments: 48 }}
        scale={[b.width, WATER_SLAB_THICKNESS_METERS, b.depth]}
        material={material}
        position={[centerX, topY, centerZ]}
      />
    );
  }
  return (
    <Scene3D.Mesh
      geometry={Geometry.Box}
      params={{ width: 1, height: 1, depth: 1 }}
      scale={[b.width, WATER_SLAB_THICKNESS_METERS, b.depth]}
      material={material}
      position={[centerX, topY, centerZ]}
    />
  );
});
