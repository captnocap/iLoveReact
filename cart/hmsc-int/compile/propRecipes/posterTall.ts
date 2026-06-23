import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const posterTallDef: PropKindDefinition = {
  kind: 'posterTall',
  label: 'Tall Poster',
  solid: true,
  footprintRadiusMeters: 0.1,
  heightMeters: 2.8,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'none',
};

const COLORS = {
  paper: recipeColor('#eef0f2'),
  image: recipeColor('#c2362f'),
  border: recipeColor('#1a1c1e'),
} satisfies Record<string, Color>;

export function posterTallRecipe(): PropRecipe {
  const h = 2.8;
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
      size: { width: 0.6, height: h * 0.82, depth: 0.01 },
      color: COLORS.image,
    },
  ];
  return { id: 'posterTall', parts };
}

export function posterTallParts(): PropPartSpec[] {
  return lowerPropRecipe(posterTallRecipe());
}
