import { box, cylinder8, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const plateDef: PropKindDefinition = {
  kind: 'plate',
  label: 'Plate',
  solid: false,
  footprintRadiusMeters: 0.2,
  heightMeters: 0.03,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
  coverClass: 'none',
};

export function plateParts(): PropPartSpec[] {
  return [
    cylinder8([0, 0.01, 0], 0.2, 0.02, hx('#eef0f2')),
    cylinder8([0, 0.02, 0], 0.14, 0.01, hx('#d6d9dc')),
  ];
}
