import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const crystalDef: PropKindDefinition = {
  kind: 'crystal',
  label: 'Crystal',
  solid: true,
  footprintRadiusMeters: 0.12,
  heightMeters: 0.35,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  main: recipeColor('#c9ccd1'),
} satisfies Record<string, Color>;

export function crystalRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'cylinder8',
      position: { x: 0, y: 0.175, z: 0 },
      radius: 0.120,
      height: 0.350,
      color: COLORS.main,
    },
  ];
  return { id: 'crystal', parts };
}

export function crystalParts(): PropPartSpec[] {
  return lowerPropRecipe(crystalRecipe());
}
