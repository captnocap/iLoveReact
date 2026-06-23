import { box, cylinder8, hx, type PropPartSpec } from '../../game/kinds/propModels';
import { type PropKindDefinition } from '../../game/kinds/props';

export const bucketDef: PropKindDefinition = {
  kind: 'bucket',
  label: 'Bucket',
  solid: true,
  footprintRadiusMeters: 0.28,
  heightMeters: 0.45,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'none',
};

export function bucketParts(): PropPartSpec[] {
  return [
    cylinder8([0, 0.22, 0], 0.28, 0.4, hx('#3a7d80')),
    cylinder8([0, 0.42, 0], 0.29, 0.04, hx('#6b4a2e')),
    box([0, 0.42, 0], [0.62, 0.02, 0.02], hx('#9aa1ab')),
  ];
}
