import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const posterWideDef: PropKindDefinition = {
  kind: 'posterWide',
  label: 'Wide Poster',
  solid: true,
  footprintRadiusMeters: 0.1,
  heightMeters: 1.2,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'none',
};

const COLORS = {
  paper: recipeColor('#eef0f2'),
  image: recipeColor('#e8b84a'),
  border: recipeColor('#1a1c1e'),
} satisfies Record<string, Color>;

export function posterWideRecipe(): PropRecipe {
  const h = 1.2;
  const parts: PropRecipePart[] = [
    {
      id: 'paper',
      shape: 'box',
      position: { x: 0, y: h * 0.5, z: 0 },
      size: { width: 1.8, height: h * 0.9, depth: 0.01 },
      color: COLORS.paper,
    },
    {
      id: 'image',
      shape: 'box',
      position: { x: 0, y: h * 0.5, z: -0.005 },
      size: { width: 1.7, height: h * 0.75, depth: 0.01 },
      color: COLORS.image,
    },
  ];
  return { id: 'posterWide', parts };
}

export function posterWideParts(): PropPartSpec[] {
  return lowerPropRecipe(posterWideRecipe());
}
