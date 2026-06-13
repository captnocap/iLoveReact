import { hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';
import { chairFrame } from './diningChair';

export const foldingChairDef: PropKindDefinition = {
  kind: 'foldingChair',
  label: 'Folding Chair',
  solid: true,
  footprintRadiusMeters: 0.3,
  heightMeters: 0.95,
  tileKind: 'wall',
  trafficControl: 'none',
  seat: { pose: 'sit', seatHeightMeters: 0.45, capacity: 1 },
  coverClass: 'soft',
};

export function foldingChairParts(): PropPartSpec[] {
  return chairFrame(hx('#3a8f4f'), hx('#3a3f46')); // default green body, metal legs (skinnable)
}
