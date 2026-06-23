import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const scarecrowDef: PropKindDefinition = {
  kind: 'scarecrow',
  label: 'Scarecrow',
  solid: true,
  footprintRadiusMeters: 0.25,
  heightMeters: 1.6,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  main: recipeColor('#8a6240'),
} satisfies Record<string, Color>;

export function scarecrowRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'box',
      position: { x: 0, y: 0.800, z: 0 },
      size: { width: 0.450, height: 1.600, depth: 0.400 },
      color: COLORS.main,
    },
  ];
  return { id: 'scarecrow', parts };
}

export function scarecrowParts(): PropPartSpec[] {
  return lowerPropRecipe(scarecrowRecipe());
}
