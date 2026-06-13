import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';

const COLORS = {
  frame: recipeColor('#3d2b1c'),
  frameLight: recipeColor('#5a4128'),
  sky: recipeColor('#7fb2d8'),
  ground: recipeColor('#5d8a4a'),
  sun: recipeColor('#f2d27a'),
} satisfies Record<string, Color>;

export function wallPaintingRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'outerFrame',
      shape: 'box',
      position: { x: 0, y: 1.5, z: -0.03 },
      size: { width: 1.25, height: 0.95, depth: 0.05 },
      color: COLORS.frame,
    },
    {
      id: 'innerFrame',
      shape: 'box',
      position: { x: 0, y: 1.5, z: -0.055 },
      size: { width: 1.15, height: 0.85, depth: 0.02 },
      color: COLORS.frameLight,
    },
    {
      id: 'paintedSky',
      shape: 'box',
      position: { x: 0, y: 1.66, z: -0.065 },
      size: { width: 1.05, height: 0.43, depth: 0.01 },
      color: COLORS.sky,
    },
    {
      id: 'paintedGround',
      shape: 'box',
      position: { x: 0, y: 1.29, z: -0.065 },
      size: { width: 1.05, height: 0.33, depth: 0.01 },
      color: COLORS.ground,
    },
    {
      id: 'paintedSun',
      shape: 'box',
      position: { x: 0.3, y: 1.7, z: -0.072 },
      size: { width: 0.16, height: 0.16, depth: 0.005 },
      color: COLORS.sun,
    },
  ];
  return { id: 'wallPainting', parts };
}

export function wallPaintingParts(): PropPartSpec[] {
  return lowerPropRecipe(wallPaintingRecipe());
}
