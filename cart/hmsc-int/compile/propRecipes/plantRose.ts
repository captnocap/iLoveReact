import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const plantRoseDef: PropKindDefinition = {
  kind: 'plantRose',
  label: 'Rose Plant',
  solid: false,
  footprintRadiusMeters: 0.12,
  heightMeters: 0.45,
  tileKind: 'bush',
  trafficControl: 'none',
};

const COLORS = {
  main: recipeColor('#c2362f'),
} satisfies Record<string, Color>;

export function plantRoseRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'cylinder8',
      position: { x: 0, y: 0.225, z: 0 },
      radius: 0.120,
      height: 0.450,
      color: COLORS.main,
    },
  ];
  return { id: 'plantRose', parts };
}

export function plantRoseParts(): PropPartSpec[] {
  return lowerPropRecipe(plantRoseRecipe());
}
