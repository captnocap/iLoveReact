import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const rockLimestoneDef: PropKindDefinition = {
  kind: 'rockLimestone',
  label: 'Limestone Rock',
  solid: true,
  footprintRadiusMeters: 0.4,
  heightMeters: 0.3,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  main: recipeColor('#d4d2c5'),
} satisfies Record<string, Color>;

export function rockLimestoneRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'box',
      position: { x: 0, y: 0.150, z: 0 },
      size: { width: 0.720, height: 0.300, depth: 0.640 },
      color: COLORS.main,
    },
  ];
  return { id: 'rockLimestone', parts };
}

export function rockLimestoneParts(): PropPartSpec[] {
  return lowerPropRecipe(rockLimestoneRecipe());
}
