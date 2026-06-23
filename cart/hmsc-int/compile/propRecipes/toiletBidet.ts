import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const toiletBidetDef: PropKindDefinition = {
  kind: 'toiletBidet',
  label: 'Bidet',
  solid: true,
  footprintRadiusMeters: 0.22,
  heightMeters: 0.4,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  main: recipeColor('#eef0f2'),
} satisfies Record<string, Color>;

export function toiletBidetRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'box',
      position: { x: 0, y: 0.200, z: 0 },
      size: { width: 0.396, height: 0.400, depth: 0.352 },
      color: COLORS.main,
    },
  ];
  return { id: 'toiletBidet', parts };
}

export function toiletBidetParts(): PropPartSpec[] {
  return lowerPropRecipe(toiletBidetRecipe());
}
