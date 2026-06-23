import { box, cylinder8, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const fireExtinguisherDef: PropKindDefinition = {
  kind: 'fireExtinguisher',
  label: 'Fire Extinguisher',
  solid: true,
  footprintRadiusMeters: 0.18,
  heightMeters: 0.55,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'none',
};

export function fireExtinguisherParts(): PropPartSpec[] {
  return [
    cylinder8([0, 0.28, 0], 0.16, 0.46, hx('#b3221c')),
    box([0, 0.54, 0], [0.12, 0.04, 0.12], hx('#22262b')),
    box([0, 0.58, 0], [0.02, 0.06, 0.02], hx('#9aa1ab')),
    box([0.1, 0.42, 0], [0.18, 0.02, 0.02], hx('#22262b'), [0, 0, -20]),
    box([0, 0.06, 0], [0.16, 0.04, 0.16], hx('#22262b')),
    box([0.1, 0.22, 0.08], [0.06, 0.1, 0.02], hx('#eef0f2')), // label
  ];
}
