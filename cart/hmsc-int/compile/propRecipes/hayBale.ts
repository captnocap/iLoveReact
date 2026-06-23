import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const hayBaleDef: PropKindDefinition = {
  kind: 'hayBale',
  label: 'Hay Bale',
  solid: true,
  footprintRadiusMeters: 0.5,
  heightMeters: 0.55,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'soft',
};

const COLORS = {
  main: recipeColor('#c2a878'),
} satisfies Record<string, Color>;

export function hayBaleRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'box',
      position: { x: 0, y: 0.275, z: 0 },
      size: { width: 0.900, height: 0.550, depth: 0.800 },
      color: COLORS.main,
    },
  ];
  return { id: 'hayBale', parts };
}

export function hayBaleParts(): PropPartSpec[] {
  return lowerPropRecipe(hayBaleRecipe());
}
