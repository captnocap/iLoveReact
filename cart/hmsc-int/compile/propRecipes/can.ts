import { cylinder8, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const canDef: PropKindDefinition = {
  kind: 'can',
  label: 'Can',
  solid: false,
  footprintRadiusMeters: 0.08,
  heightMeters: 0.13,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
  coverClass: 'none',
};

export function canParts(): PropPartSpec[] {
  return [
    cylinder8([0, 0.065, 0], 0.08, 0.13, hx('#9aa1ab')),
    cylinder8([0, 0.12, 0], 0.078, 0.01, hx('#d6d9dc')),
    cylinder8([0, 0.01, 0], 0.078, 0.01, hx('#d6d9dc')),
  ];
}
