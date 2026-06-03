import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { Building } from '../../design';
import { usedCarLotSpec } from '../../world/structures';
import { buildingPart, buildingYawDegrees, yawAboutCenter, yawAnchored } from '../buildingTransform';
import { Car } from './Car';
import { Storefront } from '../materials';

// A used car lot, drawn from usedCarLotSpec — rows of cars facing the front, a
// small glass sales kiosk in the back corner, a tall price banner, and pennant
// flag strings overhead. Only the kiosk + sign post are solid (structureSolids);
// the lot itself is open ground you walk between the cars on.
//
// Turns with its yaw like any building: parts place through buildingPart
// (+ rotation), cars ride yawAnchored, and pennant endpoints rotate about centre.

const KIOSK_WALL = '#e3e7ea';
const KIOSK_GLASS = Storefront(); // translucent, breakable showroom glass

const KIOSK_ROOF = '#3f6f9b';
const KIOSK_SIGN = '#d8472f';
const POLE = '#55595f';
const BANNER = '#1f7a44';
const BANNER_EDGE = '#f5d020';
const CABLE = '#3a3d42';
const PENNANT_COLORS = ['#e34b3a', '#f5c531', '#3b82c4', '#3aa758'];

const PENNANT_SPACING = 1.6;

export function UsedCarLot(props: { building: Building }) {
  const b = props.building;
  const yaw = buildingYawDegrees(b);
  const spec = usedCarLotSpec(b);

  const k = spec.kiosk;
  const kW = k.maxX - k.minX;
  const kD = k.maxZ - k.minZ;
  const kx = (k.minX + k.maxX) / 2;
  const kz = (k.minZ + k.maxZ) / 2;

  return (
    <>
      {/* Sales kiosk: glass lower band, solid upper wall, flat roof, sign strip. */}
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[kW, 1.4, kD]} material={KIOSK_GLASS} rotation={[0, yaw, 0]} position={buildingPart(b, kx, b.y + 0.7, kz)} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[kW, k.topY - (b.y + 1.4), kD]} material={KIOSK_WALL} rotation={[0, yaw, 0]} position={buildingPart(b, kx, (b.y + 1.4 + k.topY) / 2, kz)} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[kW + 0.3, 0.3, kD + 0.3]} material={KIOSK_ROOF} rotation={[0, yaw, 0]} position={buildingPart(b, kx, k.topY + 0.1, kz)} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[kW - 0.4, 0.55, 0.12]} material={KIOSK_SIGN} rotation={[0, yaw, 0]} position={buildingPart(b, kx, k.topY - 0.5, k.minZ - 0.08)} />

      {/* Price banner: pole + a tall green banner with a yellow top edge. */}
      <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 0.16, height: spec.sign.topY - b.y, segments: 10 }} material={POLE} rotation={[0, yaw, 0]} position={buildingPart(b, spec.sign.x, (b.y + spec.sign.topY) / 2, spec.sign.z)} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[0.16, 2.0, 1.8]} material={BANNER} rotation={[0, yaw, 0]} position={buildingPart(b, spec.sign.x, spec.sign.topY - 1.1, spec.sign.z)} />
      <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[0.2, 0.4, 1.9]} material={BANNER_EDGE} rotation={[0, yaw, 0]} position={buildingPart(b, spec.sign.x, spec.sign.topY - 0.2, spec.sign.z)} />

      {/* Pennant strings: a cable with little triangular flags (down-cones). */}
      {spec.pennants.flatMap((string, si) => {
        const dx = string.to.x - string.from.x;
        const dz = string.to.z - string.from.z;
        const len = Math.hypot(dx, dz);
        const count = Math.max(1, Math.floor(len / PENNANT_SPACING));
        const cable = (
          <Scene3D.Mesh
            key={`cable-${si}`}
            geometry={Geometry.Box}
            params={{ width: 1, height: 1, depth: 1 }}
            scale={[Math.abs(dx) + 0.1, 0.04, Math.abs(dz) + 0.04]}
            material={CABLE}
            rotation={[0, yaw, 0]}
            position={buildingPart(b, (string.from.x + string.to.x) / 2, string.y, (string.from.z + string.to.z) / 2)}
          />
        );
        const flags = Array.from({ length: count }, (_, i) => {
          const t = (i + 0.5) / count;
          const [fx, fz] = yawAboutCenter(b, string.from.x + dx * t, string.from.z + dz * t);
          return (
            <Scene3D.Mesh
              key={`flag-${si}-${i}`}
              geometry={Geometry.Cone}
              params={{ radius: 0.22, height: 0.4, segments: 4 }}
              material={PENNANT_COLORS[(si + i) % PENNANT_COLORS.length]}
              position={[fx, string.y - 0.24, fz]}
              rotation={[180, 0, 0]}
            />
          );
        });
        return [cable, ...flags];
      })}

      {/* Cars for sale. */}
      {spec.cars.map((car, i) => (
        <Car key={`car-${i}`} car={yawAnchored(b, car)} />
      ))}
    </>
  );
}
