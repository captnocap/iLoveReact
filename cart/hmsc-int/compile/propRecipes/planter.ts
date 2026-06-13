import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';

const COLORS = {
  pot: recipeColor('#a8593a'),
  soil: recipeColor('#3e2f22'),
  leafMid: recipeColor('#2f6b2f'),
  leafLight: recipeColor('#43883a'),
  bloomPink: recipeColor('#d65d8a'),
  bloomYellow: recipeColor('#e8c84a'),
} satisfies Record<string, Color>;

export function planterRecipe(heightMeters: number, footprintRadiusMeters: number): PropRecipe {
  const h = heightMeters;
  const half = footprintRadiusMeters;
  const boxH = h * 0.7;
  const parts: PropRecipePart[] = [
    {
      id: 'pot',
      shape: 'box',
      position: { x: 0, y: boxH / 2, z: 0 },
      size: { width: half * 2, height: boxH, depth: half * 2 },
      color: COLORS.pot,
    },
    {
      id: 'soil',
      shape: 'box',
      position: { x: 0, y: boxH, z: 0 },
      size: { width: half * 1.8, height: h * 0.06, depth: half * 1.8 },
      color: COLORS.soil,
    },
    {
      id: 'leftFoliage',
      shape: 'sphere',
      position: { x: -half * 0.4, y: boxH + h * 0.18, z: -half * 0.2 },
      size: { width: half * 0.8, height: h * 0.56, depth: half * 0.8 },
      color: COLORS.leafMid,
    },
    {
      id: 'rightFoliage',
      shape: 'sphere',
      position: { x: half * 0.35, y: boxH + h * 0.14, z: half * 0.25 },
      size: { width: half * 0.76, height: h * 0.48, depth: half * 0.76 },
      color: COLORS.leafLight,
    },
    {
      id: 'topFoliage',
      shape: 'sphere',
      position: { x: 0, y: boxH + h * 0.22, z: 0 },
      size: { width: half * 0.84, height: h * 0.6, depth: half * 0.84 },
      color: COLORS.leafMid,
    },
    {
      id: 'pinkBloom',
      shape: 'sphere',
      position: { x: -half * 0.45, y: boxH + h * 0.38, z: half * 0.15 },
      size: { width: h * 0.12, height: h * 0.12, depth: h * 0.12 },
      color: COLORS.bloomPink,
    },
    {
      id: 'yellowBloom',
      shape: 'sphere',
      position: { x: half * 0.4, y: boxH + h * 0.34, z: -half * 0.2 },
      size: { width: h * 0.11, height: h * 0.11, depth: h * 0.11 },
      color: COLORS.bloomYellow,
    },
  ];
  return { id: 'planter', parts };
}

export function planterParts(heightMeters: number, footprintRadiusMeters: number): PropPartSpec[] {
  return lowerPropRecipe(planterRecipe(heightMeters, footprintRadiusMeters));
}
