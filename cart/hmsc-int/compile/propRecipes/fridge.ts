import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';

const COLORS = {
  body: recipeColor('#d6d9dc'),
  dark: recipeColor('#aab0b6'),
  black: recipeColor('#22262b'),
} satisfies Record<string, Color>;

export function fridgeRecipe(heightMeters: number, footprintRadiusMeters: number): PropRecipe {
  const h = heightMeters;
  const w = footprintRadiusMeters * 2;
  const d = 0.72;
  const seamY = h * 0.68;
  const parts: PropRecipePart[] = [
    {
      id: 'base',
      shape: 'box',
      position: { x: 0, y: 0.04, z: 0 },
      size: { width: w * 0.9, height: 0.08, depth: d * 0.9 },
      color: COLORS.black,
    },
    {
      id: 'body',
      shape: 'box',
      position: { x: 0, y: h / 2 + 0.04, z: 0 },
      size: { width: w, height: h - 0.08, depth: d },
      color: COLORS.body,
    },
    {
      id: 'seam',
      shape: 'box',
      position: { x: 0, y: seamY, z: -d / 2 + 0.002 },
      size: { width: w, height: 0.02, depth: 0.02 },
      color: COLORS.dark,
    },
    {
      id: 'lowerHandle',
      shape: 'box',
      position: { x: -w * 0.34, y: seamY - h * 0.18, z: -d / 2 - 0.025 },
      size: { width: 0.035, height: h * 0.3, depth: 0.035 },
      color: COLORS.dark,
    },
    {
      id: 'upperHandle',
      shape: 'box',
      position: { x: -w * 0.34, y: seamY + h * 0.1, z: -d / 2 - 0.025 },
      size: { width: 0.035, height: h * 0.14, depth: 0.035 },
      color: COLORS.dark,
    },
  ];
  return { id: 'fridge', parts };
}

export function fridgeParts(heightMeters: number, footprintRadiusMeters: number): PropPartSpec[] {
  return lowerPropRecipe(fridgeRecipe(heightMeters, footprintRadiusMeters));
}
