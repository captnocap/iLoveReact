import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { Building } from '../../design';
import { gasStationSpec, type FuelPump } from '../../world/structures';
import { rotateYaw, type V3 } from '../props/place';
import { buildingPart, buildingYawDegrees, yawAnchored } from '../buildingTransform';
import { Glass, Storefront } from '../materials';

// A gas station, drawn from gasStationSpec — a flat lit canopy on slim pillars
// over two fuel-pump islands, with a convenience store box at the back and a tall
// price pylon by the front. The canopy + store are the structure's solid read
// (structureSolids); the open forecourt under the canopy is walkable.
//
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

export function GasStation(props: { building: Building }) {
  const b = props.building;
  const yaw = buildingYawDegrees(b);
  const spec = gasStationSpec(b);
  const c = spec.canopy;
  const cW = c.maxX - c.minX;
  const cD = c.maxZ - c.minZ;
  const cx = (c.minX + c.maxX) / 2;
  const cz = (c.minZ + c.maxZ) / 2;
  const fasciaH = 0.7;

  const s = spec.store;
  const sW = s.maxX - s.minX;
  const sD = s.maxZ - s.minZ;
  const sx = (s.minX + s.maxX) / 2;
  const sz = (s.minZ + s.maxZ) / 2;

  return (
    <>
      {/* Canopy deck (bright underside) + a red fascia band around its edge. */}
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[cW, 0.45, cD]} material={CANOPY_WHITE} rotation={[0, yaw, 0]} position={buildingPart(b, cx, (c.bottomY + c.topY) / 2, cz)} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[cW + 0.2, fasciaH, 0.18]} material={CANOPY_FASCIA} rotation={[0, yaw, 0]} position={buildingPart(b, cx, c.bottomY - fasciaH / 2 + 0.1, c.minZ)} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[cW + 0.2, fasciaH, 0.18]} material={CANOPY_FASCIA} rotation={[0, yaw, 0]} position={buildingPart(b, cx, c.bottomY - fasciaH / 2 + 0.1, c.maxZ)} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[0.18, fasciaH, cD + 0.2]} material={CANOPY_FASCIA} rotation={[0, yaw, 0]} position={buildingPart(b, c.minX, c.bottomY - fasciaH / 2 + 0.1, cz)} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[0.18, fasciaH, cD + 0.2]} material={CANOPY_FASCIA} rotation={[0, yaw, 0]} position={buildingPart(b, c.maxX, c.bottomY - fasciaH / 2 + 0.1, cz)} />

      {/* Canopy pillars. */}
      {spec.pillars.map((p, i) => (
        <Scene3D.Mesh key={`gp-${i}`} geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[0.55, p.topY - b.y, 0.55]} material={PILLAR} rotation={[0, yaw, 0]} position={buildingPart(b, p.x, (b.y + p.topY) / 2, p.z)} />
      ))}

      {/* Fuel pumps. */}
      {spec.pumps.map((pump, i) => (
        <Pump key={`pump-${i}`} pump={yawAnchored(b, pump)} />
      ))}

      {/* Convenience store box (back edge) with a glass storefront + roof cap + a
          lit sign band. */}
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[sW, s.topY - s.y, sD]} material={STORE_WALL} rotation={[0, yaw, 0]} position={buildingPart(b, sx, (s.y + s.topY) / 2, sz)} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[sW + 0.2, 0.35, sD + 0.2]} material={STORE_ROOF} rotation={[0, yaw, 0]} position={buildingPart(b, sx, s.topY, sz)} />
      {/* storefront glass facing the forecourt (−Z face) */}
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[sW - 1, 1.8, 0.1]} material={STORE_GLASS} rotation={[0, yaw, 0]} position={buildingPart(b, sx, s.y + 1.2, s.minZ - 0.06)} />
      {/* a clear window on each side wall (±X), proud of the wall so it reads as
          glass you see through — visible whichever way the station faces */}
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[0.1, 1.2, Math.min(1.8, sD * 0.55)]} material={STORE_WINDOW} rotation={[0, yaw, 0]} position={buildingPart(b, s.maxX + 0.06, s.y + 1.3, sz)} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[0.1, 1.2, Math.min(1.8, sD * 0.55)]} material={STORE_WINDOW} rotation={[0, yaw, 0]} position={buildingPart(b, s.minX - 0.06, s.y + 1.3, sz)} />
      {/* sign band above the glass */}
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[sW - 0.6, 0.7, 0.12]} material={STORE_SIGN} rotation={[0, yaw, 0]} position={buildingPart(b, sx, s.y + 2.5, s.minZ - 0.08)} />

      {/* Price pylon sign by the front corner: pole + a yellow board with a red
          price stripe. */}
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.16, height: spec.sign.topY - b.y, segments: 10 }} material={SIGN_POLE} rotation={[0, yaw, 0]} position={buildingPart(b, spec.sign.x, (b.y + spec.sign.topY) / 2, spec.sign.z)} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[2.4, 1.6, 0.22]} material={SIGN_BOARD} rotation={[0, yaw, 0]} position={buildingPart(b, spec.sign.x, spec.sign.topY - 0.9, spec.sign.z)} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[2.1, 0.55, 0.28]} material={PRICE_RED} rotation={[0, yaw, 0]} position={buildingPart(b, spec.sign.x, spec.sign.topY - 1.35, spec.sign.z)} />
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
