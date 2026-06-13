import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';

const COLORS = {
  pole: recipeColor('#3a3f46'),
  board: recipeColor('#e8eaec'),
  rim: recipeColor('#d3722c'),
} satisfies Record<string, Color>;

export function basketballHoopRecipe(heightMeters: number): PropRecipe {
  const h = heightMeters;
  const rimY = 3.5;
  const boardZ = -0.35;
  const parts: PropRecipePart[] = [
    {
      id: 'pole',
      shape: 'cylinder8',
      position: { x: 0, y: (h - 0.4) / 2, z: 0 },
      radius: 0.07,
      height: h - 0.4,
      color: COLORS.pole,
    },
    {
      id: 'arm',
      shape: 'box',
      position: { x: 0, y: h - 0.45, z: boardZ / 2 },
      size: { width: 0.06, height: 0.06, depth: 0.42 },
      color: COLORS.pole,
      rotation: { pitch: 14, yaw: 0, roll: 0 },
    },
    {
      id: 'backboard',
      shape: 'box',
      position: { x: 0, y: rimY + 0.32, z: boardZ },
      size: { width: 1.1, height: 0.75, depth: 0.04 },
      color: COLORS.board,
    },
    {
      id: 'shootBox',
      shape: 'box',
      position: { x: 0, y: rimY + 0.2, z: boardZ - 0.018 },
      size: { width: 0.45, height: 0.32, depth: 0.015 },
      color: COLORS.rim,
    },
    {
      id: 'shootBoxInner',
      shape: 'box',
      position: { x: 0, y: rimY + 0.19, z: boardZ - 0.02 },
      size: { width: 0.34, height: 0.22, depth: 0.018 },
      color: COLORS.board,
    },
    {
      id: 'rim',
      shape: 'cylinder16',
      position: { x: 0, y: rimY, z: boardZ - 0.26 },
      radius: 0.245,
      height: 0.035,
      color: COLORS.rim,
    },
  ];
  return { id: 'basketballHoop', parts };
}

export function basketballHoopParts(heightMeters: number): PropPartSpec[] {
  return lowerPropRecipe(basketballHoopRecipe(heightMeters));
}
