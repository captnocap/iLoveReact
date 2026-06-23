import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const slideDef: PropKindDefinition = {
  kind: 'slide',
  label: 'Slide',
  solid: true,
  footprintRadiusMeters: 0.6,
  heightMeters: 1.2,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  main: recipeColor('#2d5a7d'),
} satisfies Record<string, Color>;

export function slideRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'box',
      position: { x: 0, y: 0.600, z: 0 },
      size: { width: 1.080, height: 1.200, depth: 0.960 },
      color: COLORS.main,
    },
  ];
  return { id: 'slide', parts };
}

export function slideParts(): PropPartSpec[] {
  return lowerPropRecipe(slideRecipe());
}
