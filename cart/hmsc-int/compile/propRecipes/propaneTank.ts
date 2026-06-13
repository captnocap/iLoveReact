import { box, cylinder8, cylinder16, hx, sphere, WHITE, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

import { type PropKindDefinition } from '../../game/kinds/props';

export const propaneTankDef: PropKindDefinition = {
  kind: 'propaneTank',
  label: 'Propane Tank',
  solid: true,
  footprintRadiusMeters: 0.24,
  heightMeters: 0.7,
  tileKind: 'wall',
  trafficControl: 'none',
  dynamics: { bodyRadiusMeters: 0.28, restitution: 0.32 },
};

export function propaneTankParts(): PropPartSpec[] {
  const h = propKindDefinition('propaneTank').heightMeters;
  return [
    cylinder16([0, h * 0.42, 0], 0.23, h * 0.56, WHITE),
    sphere([0, h * 0.7, 0], [0.46, h * 0.42, 0.46], WHITE),
    cylinder16([0, h * 0.07, 0], 0.2, h * 0.14, hx('#d2d4d6')),
    cylinder8([0, h * 0.88, 0], 0.12, h * 0.16, hx('#d2d4d6')),
    box([0, h * 0.97, 0], [0.1, h * 0.06, 0.04], hx('#c14d4d')),
  ];
}
