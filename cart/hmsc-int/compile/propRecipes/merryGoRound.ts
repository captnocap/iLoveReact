import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const merryGoRoundDef: PropKindDefinition = {
  kind: 'merryGoRound',
  label: 'Merry Go Round',
  solid: true,
  footprintRadiusMeters: 1.2,
  heightMeters: 0.4,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  main: recipeColor('#c2362f'),
} satisfies Record<string, Color>;

export function merryGoRoundRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'cylinder16',
      position: { x: 0, y: 0.200, z: 0 },
      radius: 1.200,
      height: 0.400,
      color: COLORS.main,
    },
  ];
  return { id: 'merryGoRound', parts };
}

export function merryGoRoundParts(): PropPartSpec[] {
  return lowerPropRecipe(merryGoRoundRecipe());
}
