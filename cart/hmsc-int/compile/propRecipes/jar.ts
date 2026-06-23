import { cylinder8, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const jarDef: PropKindDefinition = {
  kind: 'jar',
  label: 'Jar',
  solid: false,
  footprintRadiusMeters: 0.1,
  heightMeters: 0.18,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
  coverClass: 'none',
};

export function jarParts(): PropPartSpec[] {
  return [
    cylinder8([0, 0.06, 0], 0.1, 0.12, hx('#bcd3dd')),
    cylinder8([0, 0.14, 0], 0.07, 0.03, hx('#bcd3dd')),
    cylinder8([0, 0.17, 0], 0.08, 0.02, hx('#6b4a2e')),
    cylinder8([0, 0.08, 0], 0.085, 0.08, hx('#3f7d33')), // contents
  ];
}
