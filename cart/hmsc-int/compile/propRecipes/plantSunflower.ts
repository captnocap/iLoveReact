import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const plantSunflowerDef: PropKindDefinition = {
  kind: 'plantSunflower',
  label: 'Sunflower',
  solid: false,
  footprintRadiusMeters: 0.15,
  heightMeters: 0.7,
  tileKind: 'bush',
  trafficControl: 'none',
};

const COLORS = {
  main: recipeColor('#e8b84a'),
} satisfies Record<string, Color>;

export function plantSunflowerRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'cylinder8',
      position: { x: 0, y: 0.350, z: 0 },
      radius: 0.150,
      height: 0.700,
      color: COLORS.main,
    },
  ];
  return { id: 'plantSunflower', parts };
}

export function plantSunflowerParts(): PropPartSpec[] {
  return lowerPropRecipe(plantSunflowerRecipe());
}
