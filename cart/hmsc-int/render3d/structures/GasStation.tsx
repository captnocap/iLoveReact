import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { Building } from '../../design';
import { gasStationSpec, type FuelPump } from '../../world/structures';
import { rotateYaw, type V3 } from '../props/place';
import { buildingPart, buildingYawDegrees, yawAnchored } from '../buildingTransform';
import { Glass, Storefront } from '../materials';
import { boxFaceParts, type Part, TexturedParts } from '../parts';

// A gas station, drawn from gasStationSpec — a flat lit canopy on slim pillars
// over two fuel-pump islands, with a convenience store box at the back and a tall
// price pylon by the front. The canopy + store are the structure's solid read
// (structureSolids); the open forecourt under the canopy is walkable.
//
// Every solid box is a PART (render3d/parts.tsx) so the click-to-pick inspector
// can re-skin it — group ids ('fascia', 'pillar') texture together. The glass
// (object materials, not texture targets) and the pump sub-models stay inline.
// The whole station turns with its yaw: box parts place through buildingPart
// (+ rotation) and the pump islands ride yawAnchored, exactly like a box building.

const CANOPY_WHITE = '#f1f4f6';
const CANOPY_FASCIA = '#c0392b';
const PILLAR = '#d6dbe0';
const PUMP_BODY = '#e7eaee';
const PUMP_SCREEN = '#1f262d';
const PUMP_BASE = '#8c9097';
const STORE_WALL = '#cdd2d7';
const STORE_GLASS = Storefront(); // translucent, breakable storefront glass
const STORE_WINDOW = Glass({ color: '#5fb6e8', opacity: 0.45 }); // tinted side window — reads as glass against the grey wall

const STORE_SIGN = '#e0483a';
const STORE_ROOF = '#9aa0a7';
const SIGN_POLE = '#4a4f55';
const SIGN_BOARD = '#f4c20d';
const PRICE_RED = '#cf2f2a';

const FASCIA_H = 0.7;

// The station's texturable parts. Geometry mirrors the renderer below — one
// source of the boxes; the part ids are what Building.partTextures keys on.
export function gasStationParts(b: Building): Part[] {
  const yaw = buildingYawDegrees(b);
  const spec = gasStationSpec(b);
  const c = spec.canopy;
  const cW = c.maxX - c.minX;
  const cD = c.maxZ - c.minZ;
  const cx = (c.minX + c.maxX) / 2;
  const cz = (c.minZ + c.maxZ) / 2;
  const s = spec.store;
  const sW = s.maxX - s.minX;
  const sD = s.maxZ - s.minZ;
  const sx = (s.minX + s.maxX) / 2;
  const sz = (s.minZ + s.maxZ) / 2;
  const unit = { width: 1, height: 1, depth: 1 };
  const rot: [number, number, number] = [0, yaw, 0];

  // Canopy fascia: 4 thin bands around the deck edge (one 'fascia' group).
  const fascias: Array<{ scale: [number, number, number]; x: number; z: number }> = [
    { scale: [cW + 0.2, FASCIA_H, 0.18], x: cx, z: c.minZ },
    { scale: [cW + 0.2, FASCIA_H, 0.18], x: cx, z: c.maxZ },
    { scale: [0.18, FASCIA_H, cD + 0.2], x: c.minX, z: cz },
    { scale: [0.18, FASCIA_H, cD + 0.2], x: c.maxX, z: cz },
  ];

  return [
    {
      id: 'canopy', label: 'Canopy', geometry: 'Box', params: unit,
      scale: [cW, 0.45, cD], texturedFaces: ['top', 'bottom'], material: CANOPY_WHITE, rotation: rot,
      position: buildingPart(b, cx, (c.bottomY + c.topY) / 2, cz),
    },
    ...fascias.map((f): Part => ({
      id: 'fascia', label: 'Canopy fascia', geometry: 'Box', params: unit,
      scale: f.scale, texturedFaces: f.scale[0] >= f.scale[2] ? ['front', 'back'] : ['left', 'right'],
      material: CANOPY_FASCIA, rotation: rot,
      position: buildingPart(b, f.x, c.bottomY - FASCIA_H / 2 + 0.1, f.z),
    })),
    ...spec.pillars.map((p): Part => ({
      id: 'pillar', label: 'Pillars', geometry: 'Box', params: unit,
      scale: [0.55, p.topY - b.y, 0.55], texturedFaces: ['front', 'back', 'left', 'right'], material: PILLAR, rotation: rot,
      position: buildingPart(b, p.x, (b.y + p.topY) / 2, p.z),
    })),
    // The store's four wall faces as separate targets (storeFront/Back/Left/Right)
    // — texturing the back wall textures THAT wall, not the whole box. The solid
    // store box itself renders inline in the component (structural, not pickable).
    ...boxFaceParts({
      id: 'store', label: 'Store',
      minX: s.minX, maxX: s.maxX, minZ: s.minZ, maxZ: s.maxZ,
      bottomY: s.y, topY: s.topY,
      material: STORE_WALL, yaw,
      place: (x, y, z) => buildingPart(b, x, y, z),
    }),
    {
      id: 'storeRoof', label: 'Store roof', geometry: 'Box', params: unit,
      scale: [sW + 0.2, 0.35, sD + 0.2], texturedFaces: ['top'], material: STORE_ROOF, rotation: rot,
      position: buildingPart(b, sx, s.topY, sz),
    },
    {
      id: 'storeSign', label: 'Store sign band', geometry: 'Box', params: unit,
      scale: [sW - 0.6, 0.7, 0.12], texturedFaces: ['front', 'back'], material: STORE_SIGN, rotation: rot,
      position: buildingPart(b, sx, s.y + 2.5, s.minZ - 0.08),
    },
    {
      id: 'signPole', label: 'Pylon pole', geometry: 'Cylinder',
      params: { radius: 0.16, height: spec.sign.topY - b.y, segments: 10 }, material: SIGN_POLE, rotation: rot,
      position: buildingPart(b, spec.sign.x, (b.y + spec.sign.topY) / 2, spec.sign.z),
    },
    {
      id: 'signBoard', label: 'Pylon board', geometry: 'Box', params: unit,
      scale: [2.4, 1.6, 0.22], texturedFaces: ['front', 'back'], material: SIGN_BOARD, rotation: rot,
      position: buildingPart(b, spec.sign.x, spec.sign.topY - 0.9, spec.sign.z),
    },
    {
      id: 'signPrice', label: 'Price stripe', geometry: 'Box', params: unit,
      scale: [2.1, 0.55, 0.28], texturedFaces: ['front', 'back'], material: PRICE_RED, rotation: rot,
      position: buildingPart(b, spec.sign.x, spec.sign.topY - 1.35, spec.sign.z),
    },
  ];
}

export function GasStation(props: { building: Building }) {
  const b = props.building;
  const yaw = buildingYawDegrees(b);
  const spec = gasStationSpec(b);
  const s = spec.store;
  const sW = s.maxX - s.minX;
  const sD = s.maxZ - s.minZ;
  const sx = (s.minX + s.maxX) / 2;
  const sz = (s.minZ + s.maxZ) / 2;

  return (
    <>
      {/* The solid store box — structural mass; its four wall FACES are the
          texturable parts (thin nudged panels), so it stays inline + unpickable. */}
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[sW, s.topY - s.y, sD]} material={STORE_WALL} rotation={[0, yaw, 0]} position={buildingPart(b, sx, (s.y + s.topY) / 2, sz)} />

      {/* Canopy + fascia + pillars + store faces + pylon — texturable parts. */}
      <TexturedParts parts={gasStationParts(b)} textures={b.partTextures} />

      {/* Fuel pumps. */}
      {spec.pumps.map((pump, i) => (
        <Pump key={`pump-${i}`} pump={yawAnchored(b, pump)} />
      ))}

      {/* Storefront glass facing the forecourt (−Z face) + a clear window on each
          side wall (±X), proud of the wall so it reads as glass you see through.
          Glass materials are objects (opacity), not texture targets — inline. */}
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[sW - 1, 1.8, 0.1]} material={STORE_GLASS} rotation={[0, yaw, 0]} position={buildingPart(b, sx, s.y + 1.2, s.minZ - 0.06)} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[0.1, 1.2, Math.min(1.8, sD * 0.55)]} material={STORE_WINDOW} rotation={[0, yaw, 0]} position={buildingPart(b, s.maxX + 0.06, s.y + 1.3, sz)} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[0.1, 1.2, Math.min(1.8, sD * 0.55)]} material={STORE_WINDOW} rotation={[0, yaw, 0]} position={buildingPart(b, s.minX - 0.06, s.y + 1.3, sz)} />
    </>
  );
}

function Pump(props: { pump: FuelPump }) {
  const p = props.pump;
  const place = (local: V3): V3 => {
    const r = rotateYaw(local, p.yawDegrees);
    return [p.x + r[0], p.y + r[1], p.z + r[2]];
  };
  return (
    <>
      {/* Island curb */}
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[1.6, 0.3, 2.4]} material={PUMP_BASE} position={place([0, 0.15, 0])} rotation={[0, p.yawDegrees, 0]} />
      {/* Two pump dispensers back-to-back on the island (flattened — the Scene3D
          runtime has no group node, so each mesh places itself off the anchor). */}
      {[0.5, -0.5].flatMap((side, i) => [
        <Scene3D.Mesh key={`body-${i}`} geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[0.7, 1.5, 0.5]} material={PUMP_BODY} position={place([side * 0.4, 1.05, 0])} rotation={[0, p.yawDegrees, 0]} />,
        <Scene3D.Mesh key={`screen-${i}`} geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[0.46, 0.5, 0.06]} material={PUMP_SCREEN} position={place([side * 0.4, 1.35, side * 0.27])} rotation={[0, p.yawDegrees, 0]} />,
        <Scene3D.Mesh key={`holster-${i}`} geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[0.16, 0.4, 0.16]} material={PUMP_SCREEN} position={place([side * 0.78, 1.0, 0])} rotation={[0, p.yawDegrees, 0]} />,
      ])}
    </>
  );
}
