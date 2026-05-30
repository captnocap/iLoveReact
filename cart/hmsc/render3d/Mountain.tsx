import { memo, useMemo } from 'react';
import { Effect, Scene3D, StaticSurface } from '@reactjit/runtime/primitives';
import * as Geometry from '@reactjit/geometries';
import type { Mountain as MountainData } from '../design';
import { craterWaterLevelY, craterWaterRadius, mountainHeightfield } from '../world/mountain';
import {
  MOUNTAIN_FILL_SHADER,
  mountainCaptureDimension,
  mountainFillData,
  mountainTextureKey,
} from './mountainFill';
import { WATER_FILL_SHADER, waterTextureKey } from './waterFill';

// Thin water-skin slab thickness, and how far the plane oversizes the lake so its
// square corners tuck UNDER the higher crater walls (visible waterline = the round
// bowl edge). Capture is a small calm texture.
const WATER_SLAB_THICKNESS_METERS = 0.15;
const WATER_PLANE_MARGIN_METERS = 4;
const WATER_CAPTURE_PX = 512;

// The crater lake surface: a flat textured plane at the water level. The host
// still walks the player on the crater bed underneath (the heightfield); this is
// the visible water + the 'water' wade footing comes from
// mountainWaterKindAtWorldPosition.
function CraterLake(props: { mountain: MountainData }) {
  const m = props.mountain;
  const level = craterWaterLevelY(m);
  const side = craterWaterRadius(m) * 2 + WATER_PLANE_MARGIN_METERS;
  return (
    <Scene3D.Mesh
      geometry={Geometry.Box}
      // Top is the water surface; sides/bottom pin to the corner texel
      // (see hmsc AGENTS.md "Textured boxes").
      params={{ width: 1, height: 1, depth: 1, texturedFaces: ['top'] }}
      scale={[side, WATER_SLAB_THICKNESS_METERS, side]}
      material="#ffffff"
      textureKey={waterTextureKey(m.id)}
      position={[m.centerX, level - WATER_SLAB_THICKNESS_METERS / 2, m.centerZ]}
    />
  );
}

// A mountain is ONE Heightfield mesh built from the same grooved height function
// the host collides against (world/mountain.ts → mountainColliderData), so the
// trail you SEE cut into the flank is exactly the surface you walk. Its surface
// texture is painted by the SAME trail math (mountainFill), captured once and
// sampled by textureKey — so the dirt path, grass flank, and rock faces line up
// exactly with the groove. 1 tile = 1 meter.

export const Mountain = memo(function Mountain(props: { mountain: MountainData }) {
  const m = props.mountain;
  const field = useMemo(
    () => mountainHeightfield(m),
    [m.centerX, m.centerZ, m.baseY, m.baseRadiusMeters, m.peakHeightMeters, m.trailStartAngleRadians],
  );
  return (
    <>
      <Scene3D.Mesh
        geometry={Geometry.Heightfield}
        params={{
          heights: field.heights,
          cols: field.cols,
          rows: field.rows,
          width: field.width,
          depth: field.depth,
          base: field.base,
        }}
        material="#ffffff"
        textureKey={mountainTextureKey(m.id)}
        position={[m.centerX, m.baseY, m.centerZ]}
      />
      <CraterLake mountain={m} />
    </>
  );
});

// One mountain's offscreen surface capture. Every prop identity (the data array
// and both style objects) is stabilized with useMemo and the component memoized,
// keyed only on the mountain's shape — so the heavy per-pixel trail shader bakes
// ONCE and the StaticSurface cache holds across all player/camera churn (the same
// rule RoadCapture/RegionCapture follow). The texture maps across the footprint
// square via the Heightfield's planar UVs.
const MountainCapture = memo(function MountainCapture(props: { mountain: MountainData }) {
  const m = props.mountain;
  const px = mountainCaptureDimension(m);
  const data = useMemo(
    () => mountainFillData(m),
    [m.centerX, m.centerZ, m.baseRadiusMeters, m.peakHeightMeters, m.trailStartAngleRadians],
  );
  const surfaceStyle = useMemo(
    () => ({ position: 'absolute' as const, left: -99999, top: 0, width: px, height: px }),
    [px],
  );
  const effectStyle = useMemo(() => ({ width: px, height: px }), [px]);
  return (
    <StaticSurface staticKey={mountainTextureKey(m.id)} style={surfaceStyle}>
      <Effect shader={MOUNTAIN_FILL_SHADER} data={data} style={effectStyle} />
    </StaticSurface>
  );
});

// One mountain's water-surface capture (a small calm texture; no shape inputs).
const WaterCapture = memo(function WaterCapture(props: { mountain: MountainData }) {
  const m = props.mountain;
  const surfaceStyle = useMemo(
    () => ({ position: 'absolute' as const, left: -99999, top: 0, width: WATER_CAPTURE_PX, height: WATER_CAPTURE_PX }),
    [],
  );
  const effectStyle = useMemo(() => ({ width: WATER_CAPTURE_PX, height: WATER_CAPTURE_PX }), []);
  const data = useMemo(() => [0], []);
  return (
    <StaticSurface staticKey={waterTextureKey(m.id)} style={surfaceStyle}>
      <Effect shader={WATER_FILL_SHADER} data={data} style={effectStyle} />
    </StaticSurface>
  );
});

// Offscreen captures (one per mountain) → the texture keys the mountain meshes
// sample. Mount in the 2D tree as a sibling of <Scene3D>, like TileSurfaceCaptures.
export const MountainSurfaceCaptures = memo(function MountainSurfaceCaptures(props: { mountains: MountainData[] }) {
  return (
    <>
      {props.mountains.map((mountain) => (
        <MountainCapture key={mountainTextureKey(mountain.id)} mountain={mountain} />
      ))}
      {props.mountains.map((mountain) => (
        <WaterCapture key={waterTextureKey(mountain.id)} mountain={mountain} />
      ))}
    </>
  );
});
