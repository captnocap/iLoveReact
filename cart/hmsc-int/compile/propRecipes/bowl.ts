import { cylinder8, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const bowlDef: PropKindDefinition = {
  kind: 'bowl',
  label: 'Bowl',
  solid: false,
  footprintRadiusMeters: 0.15,
  heightMeters: 0.08,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
  coverClass: 'none',
};

export function bowlParts(): PropPartSpec[] {
  return [
    cylinder8([0, 0.03, 0], 0.15, 0.04, hx('#eef0f2')),
    cylinder8([0, 0.05, 0], 0.12, 0.02, hx('#d6d9dc')),
  ];
}
