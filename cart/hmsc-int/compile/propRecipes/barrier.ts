import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';

const COLORS = {
  concrete: recipeColor('#9a9a92'),
  concreteDark: recipeColor('#82827a'),
} satisfies Record<string, Color>;

export function barrierRecipe(heightMeters: number, footprintRadiusMeters: number): PropRecipe {
  const w = footprintRadiusMeters * 2;
  const h = heightMeters;
  const parts: PropRecipePart[] = [
    {
      id: 'base',
      shape: 'box',
      position: { x: 0, y: h * 0.14, z: 0 },
      size: { width: w, height: h * 0.28, depth: 0.6 },
      color: COLORS.concreteDark,
    },
    {
      id: 'midWall',
      shape: 'box',
      position: { x: 0, y: h * 0.47, z: 0 },
      size: { width: w, height: h * 0.42, depth: 0.4 },
      color: COLORS.concrete,
    },
    {
      id: 'topWall',
      shape: 'box',
      position: { x: 0, y: h * 0.85, z: 0 },
      size: { width: w, height: h * 0.3, depth: 0.24 },
      color: COLORS.concrete,
    },
    {
      id: 'leftFoot',
      shape: 'box',
      position: { x: -w * 0.3, y: h * 0.1, z: 0 },
      size: { width: 0.18, height: h * 0.12, depth: 0.62 },
      color: COLORS.concreteDark,
    },
    {
      id: 'rightFoot',
      shape: 'box',
      position: { x: w * 0.3, y: h * 0.1, z: 0 },
      size: { width: 0.18, height: h * 0.12, depth: 0.62 },
      color: COLORS.concreteDark,
    },
  ];
  return { id: 'barrier', parts };
}

export function barrierParts(heightMeters: number, footprintRadiusMeters: number): PropPartSpec[] {
  return lowerPropRecipe(barrierRecipe(heightMeters, footprintRadiusMeters));
}
