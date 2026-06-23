import { box, cylinder8, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const waterCoolerDef: PropKindDefinition = {
  kind: 'waterCooler',
  label: 'Water Cooler',
  solid: true,
  footprintRadiusMeters: 0.3,
  heightMeters: 1.2,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'none',
};

export function waterCoolerParts(): PropPartSpec[] {
  return [
    box([0, 0.06, 0], [0.5, 0.1, 0.5], hx('#d6d9dc')),
    box([0, 0.4, 0], [0.45, 0.6, 0.45], hx('#d6d9dc')),
    cylinder8([0, 0.82, 0], 0.18, 0.55, hx('#3a7d80')),
    box([0, 1.0, -0.23], [0.15, 0.04, 0.06], hx('#22262b')),
    box([0, 0.65, -0.23], [0.04, 0.12, 0.04], hx('#9aa1ab')),
  ];
}
