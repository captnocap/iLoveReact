import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const posterDef: PropKindDefinition = {
  kind: 'poster',
  label: 'Poster',
  solid: true,
  footprintRadiusMeters: 0.05,
  heightMeters: 2.3,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'none',
};

const COLORS = {
  paper: recipeColor('#eef0f2'),
  image: recipeColor('#3a7d80'),
  border: recipeColor('#1a1c1e'),
} satisfies Record<string, Color>;

export function posterRecipe(): PropRecipe {
  const h = 2.3;
  const parts: PropRecipePart[] = [
    {
      id: 'paper',
      shape: 'box',
      position: { x: 0, y: h * 0.5, z: 0 },
      size: { width: 0.7, height: h * 0.9, depth: 0.01 },
      color: COLORS.paper,
    },
    {
      id: 'image',
      shape: 'box',
      position: { x: 0, y: h * 0.5, z: -0.005 },
      size: { width: 0.6, height: h * 0.75, depth: 0.01 },
      color: COLORS.image,
    },
    {
      id: 'borderTop',
      shape: 'box',
      position: { x: 0, y: h * 0.93, z: -0.006 },
      size: { width: 0.64, height: 0.02, depth: 0.01 },
      color: COLORS.border,
    },
    {
      id: 'borderBottom',
      shape: 'box',
      position: { x: 0, y: h * 0.07, z: -0.006 },
      size: { width: 0.64, height: 0.02, depth: 0.01 },
      color: COLORS.border,
    },
  ];
  return { id: 'poster', parts };
}

export function posterParts(): PropPartSpec[] {
  return lowerPropRecipe(posterRecipe());
}
