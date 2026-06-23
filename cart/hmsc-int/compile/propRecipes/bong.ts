import { box, cylinder8, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const bongDef: PropKindDefinition = {
  kind: 'bong',
  label: 'Bong',
  solid: false,
  footprintRadiusMeters: 0.12,
  heightMeters: 0.28,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
  coverClass: 'none',
};

export function bongParts(): PropPartSpec[] {
  return [
    cylinder8([0, 0.14, 0], 0.1, 0.28, hx('#bcd3dd')),
    cylinder8([0, 0.28, 0], 0.06, 0.08, hx('#bcd3dd')),
    box([0.12, 0.2, 0], [0.12, 0.02, 0.02], hx('#9aa1ab'), [0, 0, -15]),
  ];
}
