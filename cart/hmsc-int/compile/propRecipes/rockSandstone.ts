import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const rockSandstoneDef: PropKindDefinition = {
  kind: 'rockSandstone',
  label: 'Sandstone Rock',
  solid: true,
  footprintRadiusMeters: 0.45,
  heightMeters: 0.35,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  main: recipeColor('#c2a878'),
} satisfies Record<string, Color>;

export function rockSandstoneRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'box',
      position: { x: 0, y: 0.175, z: 0 },
      size: { width: 0.810, height: 0.350, depth: 0.720 },
      color: COLORS.main,
    },
  ];
  return { id: 'rockSandstone', parts };
}

export function rockSandstoneParts(): PropPartSpec[] {
  return lowerPropRecipe(rockSandstoneRecipe());
}
