import { hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';
import { chairFrame } from './diningChair';

export const officeChairDef: PropKindDefinition = {
  kind: 'officeChair',
  label: 'Office Chair',
  solid: true,
  footprintRadiusMeters: 0.3,
  heightMeters: 0.95,
  tileKind: 'wall',
  trafficControl: 'none',
  seat: { pose: 'sit', seatHeightMeters: 0.45, capacity: 1 },
  coverClass: 'soft',
};

export function officeChairParts(): PropPartSpec[] {
  return chairFrame(hx('#2e6fb0'), hx('#3a3f46')); // default blue body, metal legs (skinnable)
}
