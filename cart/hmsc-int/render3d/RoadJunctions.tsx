import { memo, useMemo } from 'react';
import { Effect, Scene3D, StaticSurface } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { RoadCulDeSac, RoadIntersection, RoadJunction } from '../design';
import { HMSC_ROAD_SCALE } from '../world/roadProfile';
import { junctionFootprint, junctionTopMeters } from '../world/roadJunctions';
import { roadCaptureDimension } from './roadFill';
import {
  CUL_DE_SAC_SHADER,
  INTERSECTION_SHADER,
  culDeSacData,
  intersectionData,
  junctionTextureKey,
} from './junctionFill';

// A junction draws as ONE square textured slab sampling its capture — the same
// one-mesh pattern as <Road>. The slab top is junctionTopMeters (one cm above
// the road slabs it joins), so it covers the through-road markings in the
// overlap and the player stands on a continuous paved surface. 1 tile = 1 meter.
const JunctionSlab = memo(function JunctionSlab(props: { junction: RoadJunction }) {
  const junction = props.junction;
  const footprint = junctionFootprint(junction);
  const side = footprint.maxX - footprint.minX;
  const thickness = HMSC_ROAD_SCALE.slabThicknessMeters;
  const top = junctionTopMeters(junction);
  return (
    <Scene3D.Mesh
      geometry={Geometry.Box}
      // Top is the crossing surface; sides/bottom pin to the corner texel
      // (see hmsc AGENTS.md "Textured boxes").
      params={{ width: 1, height: 1, depth: 1, texturedFaces: ['top'] }}
      scale={[side, thickness, side]}
      material="#ffffff"
      textureKey={junctionTextureKey(junction.id)}
      position={[footprint.minX + side / 2, top - thickness / 2, footprint.minZ + side / 2]}
    />
  );
});

// A four-way crossing. Lay it where a north-south and an east-west road cross,
// with the same profile, so the lane/sidewalk widths line up.
export const Intersection = memo(function Intersection(props: { junction: RoadIntersection }) {
  return <JunctionSlab junction={props.junction} />;
});

// A dead-end turnaround bulb. Lay it at the end of a road, with `throat` facing
// back toward that road so the ring opens for it.
export const CulDeSac = memo(function CulDeSac(props: { junction: RoadCulDeSac }) {
  return <JunctionSlab junction={props.junction} />;
});

// One junction's offscreen capture. Data/style identities are memoized and the
// component is memoized on the (referentially stable) junction, so the heavy
// shader bakes ONCE and the StaticSurface cache holds across player/camera
// frames — the rebake-safety contract from tileSurface.tsx.
const JunctionCapture = memo(function JunctionCapture(props: { junction: RoadJunction }) {
  const junction = props.junction;
  const footprint = junctionFootprint(junction);
  const sidePx = roadCaptureDimension(footprint.maxX - footprint.minX);
  const shader = junction.kind === 'intersection' ? INTERSECTION_SHADER : CUL_DE_SAC_SHADER;
  const data = useMemo(
    () => (junction.kind === 'intersection' ? intersectionData(junction) : culDeSacData(junction)),
    [junction],
  );
  const surfaceStyle = useMemo(
    () => ({ position: 'absolute' as const, left: -99999, top: 0, width: sidePx, height: sidePx }),
    [sidePx],
  );
  const effectStyle = useMemo(() => ({ width: sidePx, height: sidePx }), [sidePx]);
  return (
    <StaticSurface staticKey={junctionTextureKey(junction.id)} style={surfaceStyle}>
      <Effect shader={shader} data={data} style={effectStyle} />
    </StaticSurface>
  );
});

// Offscreen captures (one per junction) → the texture keys the junction slabs
// sample. Mount in the 2D tree as a sibling of <Scene3D>, like the road/tile captures.
export const RoadJunctionCaptures = memo(function RoadJunctionCaptures(props: { junctions: RoadJunction[] }) {
  return (
    <>
      {props.junctions.map((junction) => (
        <JunctionCapture key={junctionTextureKey(junction.id)} junction={junction} />
      ))}
    </>
  );
});
