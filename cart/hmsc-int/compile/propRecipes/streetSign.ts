import {
  lowerPropRecipe,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';

const COLORS = {
  base: [0.42, 0.45, 0.48],
  pole: [0.6, 0.63, 0.67],
  signFace: [0.08, 0.42, 0.26],
} satisfies Record<string, Color>;

export function streetSignRecipe(heightMeters: number): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'base',
      shape: 'cylinder8',
      position: { x: 0, y: 0.06, z: 0 },
      radius: 0.14,
      height: 0.12,
      color: COLORS.base,
    },
    {
      id: 'pole',
      shape: 'cylinder8',
      position: { x: 0, y: heightMeters / 2, z: 0 },
      radius: 0.05,
      height: heightMeters,
      color: COLORS.pole,
    },
    {
      id: 'signFace',
      shape: 'box',
      position: { x: 0, y: heightMeters - 0.32, z: -0.04 },
      size: { width: 1.5, height: 0.44, depth: 0.03 },
      color: COLORS.signFace,
    },
  ];
  return { id: 'streetSign', parts };
}

export function streetSignParts(heightMeters: number): PropPartSpec[] {
  return lowerPropRecipe(streetSignRecipe(heightMeters));
}
