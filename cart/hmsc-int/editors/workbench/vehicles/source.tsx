// editors/workbench/vehicles/source.tsx -- VEHICLE WorkbenchSource.

import type { WorkbenchSource } from '../../../shell/Workbench';
import { vehicleSourceCore } from './panel';
import type { VehicleLens, VehicleStore } from './store';
import { VehicleStage } from './Stage';

export { vehiclePanel, VEHICLE_LENSES } from './panel';

export function vehiclesSource(store?: VehicleStore): WorkbenchSource<VehicleStore> {
  const core = vehicleSourceCore(store);
  return {
    ...core,
    stage: (subject, lens) => <VehicleStage store={subject} lens={lens as VehicleLens} />,
  };
}
