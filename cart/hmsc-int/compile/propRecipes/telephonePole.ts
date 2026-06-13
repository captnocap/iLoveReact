import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';

const COLORS = {
  wood: recipeColor('#4f3d2a'),
  woodDark: recipeColor('#3e3021'),
  insulator: recipeColor('#9aa8b5'),
} satisfies Record<string, Color>;

export function telephonePoleRecipe(heightMeters: number, footprintRadiusMeters: number): PropRecipe {
  const h = heightMeters;
  const r = footprintRadiusMeters;
  const parts: PropRecipePart[] = [
    {
      id: 'pole',
      shape: 'cylinder8',
      position: { x: 0, y: h / 2, z: 0 },
      radius: r * 0.8,
      height: h,
      color: COLORS.wood,
    },
  ];
  const crossarms: [number, number][] = [
    [h * 0.92, 1.7],
    [h * 0.82, 1.3],
  ];
  crossarms.forEach(([y, width], i) => {
    parts.push({
      id: `crossarm${i}`,
      shape: 'box',
      position: { x: 0, y, z: 0 },
      size: { width, height: 0.09, depth: 0.09 },
      color: COLORS.woodDark,
    });
    parts.push({
      id: `leftInsulator${i}`,
      shape: 'cylinder8',
      position: { x: -width * 0.42, y: y + 0.08, z: 0 },
      radius: 0.03,
      height: 0.1,
      color: COLORS.insulator,
    });
    parts.push({
      id: `rightInsulator${i}`,
      shape: 'cylinder8',
      position: { x: width * 0.42, y: y + 0.08, z: 0 },
      radius: 0.03,
      height: 0.1,
      color: COLORS.insulator,
    });
  });
  return { id: 'telephonePole', parts };
}

export function telephonePoleParts(heightMeters: number, footprintRadiusMeters: number): PropPartSpec[] {
  return lowerPropRecipe(telephonePoleRecipe(heightMeters, footprintRadiusMeters));
}
