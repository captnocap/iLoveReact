import { useMemo } from 'react';
import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { Building } from '../../design';
import { parkingGarageField, parkingGarageSpec } from '../../world/structures';
import { buildingPart, buildingYawDegrees, yawAnchored } from '../buildingTransform';
import { Car } from './Car';

// A two-level open parking garage. The ground floor + the ramp are ONE Heightfield
// mesh built from the same field the host walks (parkingGarageField → registered in
// state/terrainColliders.ts) — the ramp you see is the ramp you climb. The upper
// deck is a flat slab whose collision is a banded platform rect (walk under it,
// stand on it). A parapet rings the deck with a gap where the ramp lands. Cars park
// on both levels. 1 tile = 1 m.
//
// Like every building, the whole structure turns with its yaw: each part is placed
// through buildingPart (anchor rotated about the building centre) + rotation, and
// cars ride yawAnchored (anchor + facing folded with the building). See
// render3d/buildingTransform.ts.

const CONCRETE = '#9a9ea3';
const CONCRETE_DARK = '#7f848a';
const DECK = '#90959b';
const PARAPET = '#868b91';
const STRIPE = '#d7dadf';
const PILLAR_SIZE = 0.7;
const DECK_THICKNESS = 0.35;
const PARAPET_THICKNESS = 0.25;
const PARAPET_HEIGHT = 0.95;

export function ParkingGarage(props: { building: Building }) {
  const b = props.building;
  const yaw = buildingYawDegrees(b);
  const spec = parkingGarageSpec(b);
  const field = useMemo(
    () => parkingGarageField(b),
    [b.x, b.z, b.y, b.widthTiles, b.depthTiles, b.kind],
  );
  const d = spec.deckArea;
  const deckCenterY = spec.deckY - DECK_THICKNESS / 2;
  const parapetCenterY = spec.deckY + PARAPET_HEIGHT / 2;
  const t = PARAPET_THICKNESS;

  // Parapet segments matching structureSolids (south edge open where the ramp tops in).
  const parapets: Array<[number, number, number, number]> = [
    [d.minX, d.maxZ - t, d.maxX, d.maxZ], // north
    [d.minX, d.minZ, d.minX + t, d.maxZ], // west
    [d.maxX - t, d.minZ, d.maxX, d.maxZ], // east
    [spec.rampStripMaxX, d.minZ, d.maxX, d.minZ + t], // south, east of the ramp opening
  ];

  return (
    <>
      {/* Ground floor + ramp — ONE heightfield mesh, the surface the host walks. */}
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
        material={CONCRETE}
        rotation={[0, yaw, 0]}
        position={buildingPart(b, spec.footprint.cx, b.y, spec.footprint.cz)}
      />

      {/* Upper deck slab (its underside is the ground floor's ceiling). */}
      <Scene3D.Mesh
        geometry={Geometry.Box}
        params={{ width: 1, height: 1, depth: 1 }}
        scale={[d.maxX - d.minX, DECK_THICKNESS, d.maxZ - d.minZ]}
        material={DECK}
        rotation={[0, yaw, 0]}
        position={buildingPart(b, (d.minX + d.maxX) / 2, deckCenterY, (d.minZ + d.maxZ) / 2)}
      />

      {/* Deck parapet. */}
      {parapets.map((p, i) => (
        <Scene3D.Mesh
          key={`parapet-${i}`}
          geometry={Geometry.Box}
          params={{ width: 1, height: 1, depth: 1 }}
          scale={[p[2] - p[0], PARAPET_HEIGHT, p[3] - p[1]]}
          material={PARAPET}
          rotation={[0, yaw, 0]}
          position={buildingPart(b, (p[0] + p[2]) / 2, parapetCenterY, (p[1] + p[3]) / 2)}
        />
      ))}

      {/* The ramp's solid side is the heightfield mesh itself (a continuous rising
          surface — not hollow), so there are no separate wall meshes to z-fight it.
          The invisible no-walk-through collision rects live in structureSolids. */}

      {/* Pillars from ground to roof. */}
      {spec.pillars.map((p, i) => (
        <Scene3D.Mesh
          key={`pillar-${i}`}
          geometry={Geometry.Box}
          params={{ width: 1, height: 1, depth: 1 }}
          scale={[PILLAR_SIZE, spec.roofTop - b.y, PILLAR_SIZE]}
          material={CONCRETE_DARK}
          rotation={[0, yaw, 0]}
          position={buildingPart(b, p.x, (b.y + spec.roofTop) / 2, p.z)}
        />
      ))}

      {/* Bay stripes on both levels. */}
      {spec.bays.map((bay, i) => (
        <Scene3D.Mesh
          key={`stripe-${i}`}
          geometry={Geometry.Box}
          params={{ width: 1, height: 1, depth: 1 }}
          scale={[0.12, 0.04, 4.6]}
          material={STRIPE}
          rotation={[0, yaw, 0]}
          position={buildingPart(b, bay.x - 1.3, bay.y + 0.04, bay.z)}
        />
      ))}

      {/* Parked cars on the ground floor and the upper deck. */}
      {spec.cars.map((car, i) => (
        <Car key={`car-${i}`} car={yawAnchored(b, car)} />
      ))}
    </>
  );
}
