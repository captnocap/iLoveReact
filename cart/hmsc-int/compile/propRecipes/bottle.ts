import { box, cylinder8, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const bottleDef: PropKindDefinition = {
  kind: 'bottle',
  label: 'Bottle',
  solid: false,
  footprintRadiusMeters: 0.1,
  heightMeters: 0.3,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
  coverClass: 'none',
};

export function bottleParts(): PropPartSpec[] {
  return [
    cylinder8([0, 0.1, 0], 0.1, 0.2, hx('#3a7d80')),
    cylinder8([0, 0.22, 0], 0.04, 0.06, hx('#3a7d80')),
    box([0, 0.28, 0], [0.06, 0.04, 0.06], hx('#6b4a2e')),
  ];
}
