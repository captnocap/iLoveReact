import { memo } from 'react';
import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { Building } from '../design';
import { buildingBoxes, buildingDoorCenter, buildingHeightMeters } from '../world/buildings';
import { buildingKindDefinition } from '../world/buildingKinds';
import { buildingCustomModel } from './buildingModels';
import { BuildingWindows } from './BuildingWindows';
import { buildingYawDegrees, yawAboutCenter } from './buildingTransform';
import { HMSC_SCALE } from '../world/scale';

// One placed building, drawn from the SAME boxes world/buildings.ts feeds to host
// physics — so the wall you see is exactly the wall you collide with. A sealed
// building is one filled box; hollow/interior are wall strips (hollow leaves a
// doorway gap, interior is a closed shell entered through its front pad). An
// interior building also gets a door panel so it reads as enterable.
// Unit-box params are literals so the geometry bakes; scale gives the footprint.

const DOOR_PANEL_COLOR = '#2b2520';

function BuildingWalls(props: { building: Building; color: string }) {
  const b = props.building;
  const height = buildingHeightMeters(b);
  const yaw = buildingYawDegrees(b);
  return (
    <>
      {buildingBoxes(b).map((box, index) => {
        const width = box.maxX - box.minX;
        const depth = box.maxZ - box.minZ;
        const [wx, wz] = yawAboutCenter(b, (box.minX + box.maxX) / 2, (box.minZ + box.maxZ) / 2);
        return (
          <Scene3D.Mesh
            key={index}
            geometry={Geometry.Box}
            params={{ width: 1, height: 1, depth: 1 }}
            scale={[width, height, depth]}
            rotation={[0, yaw, 0]}
            material={props.color}
            position={[wx, b.y + height / 2, wz]}
          />
        );
      })}
    </>
  );
}

// A closed building's front door: a thin tall panel in the doorway opening, so a
// player can see which building they can enter (its pad fires wv_enter).
function BuildingDoor(props: { building: Building }) {
  const b = props.building;
  const center = buildingDoorCenter(b);
  const doorWidth = HMSC_SCALE.doorWidthMeters;
  const doorHeight = HMSC_SCALE.doorHeightMeters;
  const thickness = 0.16;
  const horizontal = b.doorSide === 'north' || b.doorSide === 'south';
  const scale: [number, number, number] = horizontal
    ? [doorWidth, doorHeight, thickness]
    : [thickness, doorHeight, doorWidth];
  const [wx, wz] = yawAboutCenter(b, center.x, center.z);
  return (
    <Scene3D.Mesh
      geometry={Geometry.Box}
      params={{ width: 1, height: 1, depth: 1 }}
      scale={scale}
      rotation={[0, buildingYawDegrees(b), 0]}
      material={DOOR_PANEL_COLOR}
      position={[wx, b.y + doorHeight / 2, wz]}
    />
  );
}

// Memoized on the (referentially stable) building so a player/camera frame does
// not re-render every building — the same statics-stability contract roads and
// props follow.
export const Building3D = memo(function Building3D(props: { building: Building }) {
  // Open structures (garage/gas/lot) draw their own sculpted model instead of the
  // box walls + facade — the same per-kind dispatch props use (Prop.tsx).
  const CustomModel = buildingCustomModel(props.building);
  if (CustomModel) return <CustomModel building={props.building} />;

  const color = buildingKindDefinition(props.building.kind).facadeColor;
  return (
    <>
      <BuildingWalls building={props.building} color={color} />
      <BuildingWindows building={props.building} />
      {props.building.enclosure === 'interior' ? <BuildingDoor building={props.building} /> : null}
    </>
  );
});
