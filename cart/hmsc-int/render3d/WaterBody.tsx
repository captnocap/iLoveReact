import { memo } from 'react';
import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { WaterBody as WaterBodyData } from '../design';
import { WATER_LOOK, waterBodyVolume } from '../game/kinds/waterBodies';

// The renderer for an authored body of water (world/water). A body is FACTORS —
// a footprint + one surface level — and the render is the dumb consequence: a
// translucent VOLUME filling from the ground plane up to surfaceY over the
// footprint. A volume (not a thin surface film) is what reads as a body of water
// with depth: walk in and the blue surrounds you up to the surface; the deeper
// the surface level, the more it covers you. Translucent (opacity routes through
// 3d.zig's back-to-front transparent pass — the same path Glass uses), so the bed
// and anything wading in it read through.
//
// rect → a Box footprint; disc → a flat Cylinder (the inscribed ellipse, drawn as
// a regular cylinder scaled to the footprint so an oval pond reads round).

export const WaterBodyMesh = memo(function WaterBodyMesh(props: { body: WaterBodyData }) {
  const b = props.body;
  const centerX = b.x + b.width / 2;
  const centerZ = b.z + b.depth / 2;
  const vol = waterBodyVolume(b.surfaceY);
  const material = { color: WATER_LOOK.color, opacity: WATER_LOOK.opacity };
  if (b.shape === 'disc') {
    // A unit cylinder (radius 0.5, height 1) scaled to the footprint — width/depth
    // become the two ellipse diameters, so a non-square footprint reads as an oval.
    return (
      <Scene3D.Mesh
        geometry={Geometry.Cylinder}
        params={{ radius: 0.5, height: 1, segments: 48 }}
        scale={[b.width, vol.height, b.depth]}
        material={material}
        position={[centerX, vol.centerY, centerZ]}
      />
    );
  }
  return (
    <Scene3D.Mesh
      geometry={Geometry.Box}
      params={{ width: 1, height: 1, depth: 1 }}
      scale={[b.width, vol.height, b.depth]}
      material={material}
      position={[centerX, vol.centerY, centerZ]}
    />
  );
});
