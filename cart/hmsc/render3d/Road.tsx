import { memo, useMemo } from 'react';
import { Effect, Scene3D, StaticSurface } from '@reactjit/runtime/primitives';
import * as Geometry from '@reactjit/geometries';
import type { RoadSegment } from '../design';
import { HMSC_ROAD_SCALE, solveRoadCrossSection } from '../world/roadProfile';
import { roadTopMeters } from '../world/roads';
import {
  ROAD_CROSS_SECTION_SHADER,
  roadCaptureDimension,
  roadCrossSectionData,
  roadTextureKey,
} from './roadFill';

// A road drawn as ONE textured slab sampling its cross-section capture — the
// same one-mesh "world as shader quad" pattern the chunk floors use, so a road
// costs one node no matter how long it is. The slab top is roadTopMeters (the
// SAME value host physics uses for the road's ground), so the player stands on
// the visible road. Unit-box params (literal -> bakes); scale gives the real
// footprint. northSouth runs along z; eastWest runs along x. 1 tile = 1 meter.
export const Road = memo(function Road(props: { road: RoadSegment }) {
  const road = props.road;
  const widthMeters = solveRoadCrossSection(road.profile).totalWidthMeters;
  const lengthMeters = road.lengthTiles;
  const thickness = HMSC_ROAD_SCALE.slabThicknessMeters;
  const top = roadTopMeters(road);
  const spanX = road.orientation === 'northSouth' ? widthMeters : lengthMeters;
  const spanZ = road.orientation === 'northSouth' ? lengthMeters : widthMeters;
  return (
    <Scene3D.Mesh
      geometry={Geometry.Box}
      params={{ width: 1, height: 1, depth: 1 }}
      scale={[spanX, thickness, spanZ]}
      material="#ffffff"
      textureKey={roadTextureKey(road.id)}
      position={[road.x + spanX / 2, top - thickness / 2, road.z + spanZ / 2]}
    />
  );
});

// One road's offscreen capture. Every prop identity (the data array and both
// style objects) is stabilized with useMemo and the component is memoized,
// keyed only on the road's shape — so the heavy shader bakes ONCE and the
// StaticSurface cache holds across all player/camera churn. Inline data/style
// identities would commit an Effect UPDATE that stamps the subtree dirty and
// re-bakes the shader every frame (the documented paint spike). Mirrors
// RegionCapture in tileSurface.tsx exactly.
const RoadCapture = memo(function RoadCapture(props: { road: RoadSegment }) {
  const road = props.road;
  const acrossMeters = solveRoadCrossSection(road.profile).totalWidthMeters;
  const alongMeters = road.lengthTiles;
  // Texture px map to the box's local x/z, so width-px follows the across span
  // for a northSouth road and the along span for an eastWest road.
  const wPx = roadCaptureDimension(road.orientation === 'northSouth' ? acrossMeters : alongMeters);
  const hPx = roadCaptureDimension(road.orientation === 'northSouth' ? alongMeters : acrossMeters);
  const data = useMemo(
    () => roadCrossSectionData(road),
    [
      road.orientation,
      road.lengthTiles,
      road.profile.lanesPerDirection,
      road.profile.hasBikeLane,
      road.profile.hasSidewalks,
    ],
  );
  const surfaceStyle = useMemo(
    () => ({ position: 'absolute' as const, left: -99999, top: 0, width: wPx, height: hPx }),
    [wPx, hPx],
  );
  const effectStyle = useMemo(() => ({ width: wPx, height: hPx }), [wPx, hPx]);
  return (
    <StaticSurface staticKey={roadTextureKey(road.id)} style={surfaceStyle}>
      <Effect shader={ROAD_CROSS_SECTION_SHADER} data={data} style={effectStyle} />
    </StaticSurface>
  );
});

// Offscreen captures (one per road) → the texture keys the road slabs sample.
// Mount in the 2D tree as a sibling of <Scene3D>, the same as TileSurfaceCaptures.
export const RoadSurfaceCaptures = memo(function RoadSurfaceCaptures(props: { roads: RoadSegment[] }) {
  return (
    <>
      {props.roads.map((road) => (
        <RoadCapture key={roadTextureKey(road.id)} road={road} />
      ))}
    </>
  );
});
