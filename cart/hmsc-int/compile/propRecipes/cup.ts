import { box, cylinder8, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const cupDef: PropKindDefinition = {
  kind: 'cup',
  label: 'Cup',
  solid: false,
  footprintRadiusMeters: 0.1,
  heightMeters: 0.12,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
  coverClass: 'none',
};

export function cupParts(): PropPartSpec[] {
  return [
    cylinder8([0, 0.05, 0], 0.09, 0.1, hx('#eef0f2')),
    box([0.1, 0.06, 0], [0.06, 0.02, 0.06], hx('#eef0f2'), [0, 0, 60]),
  ];
}
