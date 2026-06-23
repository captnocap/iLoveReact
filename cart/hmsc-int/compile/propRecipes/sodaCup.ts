import { box, cylinder8, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const sodaCupDef: PropKindDefinition = {
  kind: 'sodaCup',
  label: 'Soda Cup',
  solid: false,
  footprintRadiusMeters: 0.08,
  heightMeters: 0.18,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
  coverClass: 'none',
};

export function sodaCupParts(): PropPartSpec[] {
  return [
    cylinder8([0, 0.06, 0], 0.07, 0.12, hx('#eef0f2')),
    cylinder8([0, 0.13, 0], 0.075, 0.02, hx('#b3221c')),
    cylinder8([0, 0.01, 0], 0.06, 0.02, hx('#6b4a2e')),
    // straw
    cylinder8([0.03, 0.19, 0.02], 0.008, 0.12, hx('#d4a83a'), [10, 0, -5]),
    // lid dome
    cylinder8([0, 0.145, 0], 0.07, 0.01, hx('#eef0f2')),
  ];
}
