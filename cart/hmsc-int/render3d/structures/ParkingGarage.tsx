import { useMemo } from 'react';
import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { Building } from '../../design';
import { parkingGarageField, parkingGarageSpec } from '../../world/structures';
import { buildingPart, buildingYawDegrees, yawAnchored } from '../buildingTransform';
import { Car } from './Car';
import { type Part, TexturedParts } from '../parts';

// A two-level open parking garage. The ground floor + the ramp are ONE Heightfield
// mesh built from the same field the host walks (parkingGarageField → registered in
// state/terrainColliders.ts) — the ramp you see is the ramp you climb. The upper
// deck is a flat slab whose collision is a banded platform rect (walk under it,
// stand on it). A parapet rings the deck with a gap where the ramp lands. Cars park
// on both levels. 1 tile = 1 m.
//
// The texturable boxes (deck + parapet + pillars) are PARTS (render3d/parts.tsx) so
// the click-to-pick inspector can re-skin them and the game renders any assigned
// texture — a garage has no "front face", but it has a deck and pillars you can
// click. The heightfield floor/ramp, bay stripes, and cars stay bespoke inline
// meshes (not flat box panels, so not texture targets). Like every building, the
// whole structure turns with its yaw via buildingPart / yawAnchored.

const CONCRETE = '#9a9ea3';
const CONCRETE_DARK = '#7f848a';
const DECK = '#90959b';
const PARAPET = '#868b91';
const STRIPE = '#d7dadf';
const PILLAR_SIZE = 0.7;
const DECK_THICKNESS = 0.35;
const PARAPET_THICKNESS = 0.25;
const PARAPET_HEIGHT = 0.95;

// The garage's texturable parts: the upper deck slab, the parapet ring (one shared
// 'parapet' id so texturing skins the whole ring), and the pillars (one shared
// 'pillar' id). Geometry mirrors the renderer below — one source of the boxes.
export function parkingGarageParts(b: Building): Part[] {
  const yaw = buildingYawDegrees(b);
  const spec = parkingGarageSpec(b);
  const d = spec.deckArea;
  const deckCenterY = spec.deckY - DECK_THICKNESS / 2;
  const parapetCenterY = spec.deckY + PARAPET_HEIGHT / 2;
  const t = PARAPET_THICKNESS;
  const parapets: Array<[number, number, number, number]> = [
    [d.minX, d.maxZ - t, d.maxX, d.maxZ],
    [d.minX, d.minZ, d.minX + t, d.maxZ],
    [d.maxX - t, d.minZ, d.maxX, d.maxZ],
    [spec.rampStripMaxX, d.minZ, d.maxX, d.minZ + t],
  ];
  return [
    {
      id: 'deck', label: 'Upper deck', geometry: 'Box', params: { width: 1, height: 1, depth: 1 },
      scale: [d.maxX - d.minX, DECK_THICKNESS, d.maxZ - d.minZ],
      texturedFaces: ['top', 'bottom'], material: DECK, rotation: [0, yaw, 0],
      position: buildingPart(b, (d.minX + d.maxX) / 2, deckCenterY, (d.minZ + d.maxZ) / 2),
    },
    ...parapets.map((p): Part => ({
      id: 'parapet', label: 'Parapet', geometry: 'Box', params: { width: 1, height: 1, depth: 1 },
      scale: [p[2] - p[0], PARAPET_HEIGHT, p[3] - p[1]],
      texturedFaces: (p[2] - p[0]) >= (p[3] - p[1]) ? ['front', 'back'] : ['left', 'right'],
      material: PARAPET, rotation: [0, yaw, 0],
      position: buildingPart(b, (p[0] + p[2]) / 2, parapetCenterY, (p[1] + p[3]) / 2),
    })),
    ...spec.pillars.map((p): Part => ({
      id: 'pillar', label: 'Pillars', geometry: 'Box', params: { width: 1, height: 1, depth: 1 },
      scale: [PILLAR_SIZE, spec.roofTop - b.y, PILLAR_SIZE],
      texturedFaces: ['front', 'back'], material: CONCRETE_DARK, rotation: [0, yaw, 0],
      position: buildingPart(b, p.x, (b.y + spec.roofTop) / 2, p.z),
    })),
  ];
}

export function ParkingGarage(props: { building: Building }) {
  const b = props.building;
  const yaw = buildingYawDegrees(b);
  const spec = parkingGarageSpec(b);
  const field = useMemo(
    () => parkingGarageField(b),
    [b.x, b.z, b.y, b.widthTiles, b.depthTiles, b.kind],
  );
  const parts = useMemo(() => parkingGarageParts(b), [b]);

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

      {/* Deck slab + parapet ring + pillars — texturable parts. */}
      <TexturedParts parts={parts} textures={b.partTextures} />

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
