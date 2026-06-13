import { box, cylinder8, hx, STEEL, STEEL_DARK, type PropPartSpec } from '../../game/kinds/propModels';
import { propKindDefinition } from '../../game/kinds/props';

import { type PropKindDefinition } from '../../game/kinds/props';

export const drinkingFountainDef: PropKindDefinition = {
  kind: 'drinkingFountain',
  label: 'Drinking Fountain',
  solid: true,
  footprintRadiusMeters: 0.2,
  heightMeters: 1.0,
  tileKind: 'wall',
  trafficControl: 'none',
};

export function drinkingFountainParts(): PropPartSpec[] {
  const h = propKindDefinition('drinkingFountain').heightMeters;
  return [
    box([0, h * 0.46, 0], [0.28, h * 0.92, 0.28], STEEL_DARK),
    box([0, h * 0.94, -0.04], [0.4, h * 0.12, 0.38], STEEL),
    cylinder8([0.08, h + 0.025, -0.08], 0.022, 0.07, hx('#d2d4d6')),
  ];
}
