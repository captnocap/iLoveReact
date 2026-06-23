import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const posterLargeDef: PropKindDefinition = {
  kind: 'posterLarge',
  label: 'Large Poster',
  solid: true,
  footprintRadiusMeters: 0.1,
  heightMeters: 2.3,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'none',
};

const COLORS = {
  paper: recipeColor('#eef0f2'),
  image: recipeColor('#7d3b4a'),
  border: recipeColor('#1a1c1e'),
} satisfies Record<string, Color>;

export function posterLargeRecipe(): PropRecipe {
  const h = 2.3;
  const parts: PropRecipePart[] = [
    {
      id: 'paper',
      shape: 'box',
      position: { x: 0, y: h * 0.5, z: 0 },
      size: { width: 1.2, height: h * 0.9, depth: 0.01 },
      color: COLORS.paper,
    },
    {
      id: 'image',
      shape: 'box',
      position: { x: 0, y: h * 0.5, z: -0.005 },
      size: { width: 1.1, height: h * 0.8, depth: 0.01 },
      color: COLORS.image,
    },
    {
      id: 'borderTop',
      shape: 'box',
      position: { x: 0, y: h * 0.93, z: -0.006 },
      size: { width: 1.16, height: 0.02, depth: 0.01 },
      color: COLORS.border,
    },
  ];
  return { id: 'posterLarge', parts };
}

export function posterLargeParts(): PropPartSpec[] {
  return lowerPropRecipe(posterLargeRecipe());
}
