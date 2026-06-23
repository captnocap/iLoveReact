import { box, cylinder8, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const makeupDef: PropKindDefinition = {
  kind: 'makeup',
  label: 'Makeup',
  solid: false,
  footprintRadiusMeters: 0.15,
  heightMeters: 0.12,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
  coverClass: 'none',
};

export function makeupParts(): PropPartSpec[] {
  return [
    box([0, 0.02, 0], [0.18, 0.04, 0.12], hx('#7d3b4a')),
    cylinder8([-0.05, 0.06, 0], 0.03, 0.08, hx('#22262b')),
    cylinder8([0.05, 0.06, 0.02], 0.025, 0.07, hx('#9aa1ab')),
    cylinder8([0, 0.07, -0.03], 0.02, 0.08, hx('#3a7d80')),
  ];
}
