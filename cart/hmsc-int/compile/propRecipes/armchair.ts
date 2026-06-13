import { hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';
import { chairFrame } from './diningChair';

export const armchairDef: PropKindDefinition = {
  kind: 'armchair',
  label: 'Armchair',
  solid: true,
  footprintRadiusMeters: 0.3,
  heightMeters: 0.95,
  tileKind: 'wall',
  trafficControl: 'none',
  seat: { pose: 'sit', seatHeightMeters: 0.45, capacity: 1 },
  coverClass: 'soft',
};

export function armchairParts(): PropPartSpec[] {
  return chairFrame(hx('#b03a2e'), hx('#3a3f46')); // default red body, metal legs (skinnable)
}
