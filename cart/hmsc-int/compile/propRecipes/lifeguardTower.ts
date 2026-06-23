import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const lifeguardTowerDef: PropKindDefinition = {
  kind: 'lifeguardTower',
  label: 'Lifeguard Tower',
  solid: true,
  footprintRadiusMeters: 0.9,
  heightMeters: 3.0,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  main: recipeColor('#e8b84a'),
} satisfies Record<string, Color>;

export function lifeguardTowerRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'box',
      position: { x: 0, y: 1.500, z: 0 },
      size: { width: 1.620, height: 3.000, depth: 1.440 },
      color: COLORS.main,
    },
  ];
  return { id: 'lifeguardTower', parts };
}

export function lifeguardTowerParts(): PropPartSpec[] {
  return lowerPropRecipe(lifeguardTowerRecipe());
}
