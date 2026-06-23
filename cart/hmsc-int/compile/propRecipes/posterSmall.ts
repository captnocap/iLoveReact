import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const posterSmallDef: PropKindDefinition = {
  kind: 'posterSmall',
  label: 'Small Poster',
  solid: true,
  footprintRadiusMeters: 0.1,
  heightMeters: 1.0,
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

export function posterSmallRecipe(): PropRecipe {
  const h = 1.0;
  const parts: PropRecipePart[] = [
    {
      id: 'paper',
      shape: 'box',
      position: { x: 0, y: h * 0.5, z: 0 },
      size: { width: 0.5, height: h * 0.9, depth: 0.01 },
      color: COLORS.paper,
    },
    {
      id: 'image',
      shape: 'box',
      position: { x: 0, y: h * 0.5, z: -0.005 },
      size: { width: 0.42, height: h * 0.75, depth: 0.01 },
      color: COLORS.image,
    },
  ];
  return { id: 'posterSmall', parts };
}

export function posterSmallParts(): PropPartSpec[] {
  return lowerPropRecipe(posterSmallRecipe());
}
