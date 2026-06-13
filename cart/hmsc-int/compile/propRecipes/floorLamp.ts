import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';

const COLORS = {
  metal: recipeColor('#3a3f46'),
  bulb: recipeColor('#ffe9a8'),
  shade: recipeColor('#e8d9b0'),
} satisfies Record<string, Color>;

export function floorLampRecipe(heightMeters: number): PropRecipe {
  const h = heightMeters;
  const parts: PropRecipePart[] = [
    {
      id: 'base',
      shape: 'cylinder16',
      position: { x: 0, y: 0.02, z: 0 },
      radius: 0.17,
      height: 0.04,
      color: COLORS.metal,
    },
    {
      id: 'pole',
      shape: 'cylinder8',
      position: { x: 0, y: (h - 0.34) / 2 + 0.04, z: 0 },
      radius: 0.022,
      height: h - 0.34,
      color: COLORS.metal,
    },
    {
      id: 'bulb',
      shape: 'sphere',
      position: { x: 0, y: h - 0.26, z: 0 },
      size: { width: 0.14, height: 0.14, depth: 0.14 },
      color: COLORS.bulb,
    },
    {
      id: 'shade',
      shape: 'cylinder16',
      position: { x: 0, y: h - 0.15, z: 0 },
      radius: 0.21,
      height: 0.3,
      color: COLORS.shade,
    },
  ];
  return { id: 'floorLamp', parts };
}

export function floorLampParts(heightMeters: number): PropPartSpec[] {
  return lowerPropRecipe(floorLampRecipe(heightMeters));
}
