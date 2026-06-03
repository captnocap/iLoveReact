import type { Building } from '../design';
import { buildingKindStructureModel } from '../world/buildingKinds';
import type { BuildingStructureModel } from '../world/buildingKinds';
import { ParkingGarage } from './structures/ParkingGarage';
import { GasStation } from './structures/GasStation';
import { UsedCarLot } from './structures/UsedCarLot';
import { DriveIn } from './structures/DriveIn';

// The one place that maps an open BuildingKind to its sculpted model — the
// buildings twin of render3d/Prop.tsx's PROP_MODELS. A box kind has no entry here
// and falls through to the uniform wall+facade renderer in Building.tsx. Adding an
// open structure is: a structureModel value in buildingKinds.ts + a spec in
// world/structures.ts + a model file + one line here.
type BuildingModel = (props: { building: Building }) => any;

const BUILDING_MODELS: Partial<Record<BuildingStructureModel, BuildingModel>> = {
  parkingGarage: ParkingGarage,
  gasStation: GasStation,
  usedCarLot: UsedCarLot,
  driveIn: DriveIn,
};

// The custom model for a building, or null when the kind uses the box+facade path.
export function buildingCustomModel(building: Building): BuildingModel | null {
  return BUILDING_MODELS[buildingKindStructureModel(building.kind)] ?? null;
}
