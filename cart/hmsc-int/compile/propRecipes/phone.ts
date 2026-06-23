import { box, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const phoneDef: PropKindDefinition = {
  kind: 'phone',
  label: 'Phone',
  solid: false,
  footprintRadiusMeters: 0.12,
  heightMeters: 0.12,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
  coverClass: 'none',
};

export function phoneParts(): PropPartSpec[] {
  return [
    box([0, 0.01, 0], [0.16, 0.02, 0.28], hx('#22262b')),
    box([0, 0.02, 0], [0.13, 0.01, 0.23], hx('#2c4a66')),
  ];
}
