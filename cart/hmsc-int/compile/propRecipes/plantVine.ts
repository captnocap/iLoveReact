import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const plantVineDef: PropKindDefinition = {
  kind: 'plantVine',
  label: 'Vine Plant',
  solid: false,
  footprintRadiusMeters: 0.12,
  heightMeters: 1.2,
  tileKind: 'bush',
  trafficControl: 'none',
  mount: 'wall',
};

const COLORS = {
  main: recipeColor('#4a6b3a'),
} satisfies Record<string, Color>;

export function plantVineRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'box',
      position: { x: 0, y: 0.600, z: 0 },
      size: { width: 0.216, height: 1.200, depth: 0.192 },
      color: COLORS.main,
    },
  ];
  return { id: 'plantVine', parts };
}

export function plantVineParts(): PropPartSpec[] {
  return lowerPropRecipe(plantVineRecipe());
}
