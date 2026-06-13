import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';

const COLORS = {
  stone: recipeColor('#6b7079'),
  stoneDark: recipeColor('#52565d'),
  stoneLight: recipeColor('#82868d'),
} satisfies Record<string, Color>;

export function rockSpireRecipe(heightMeters: number, footprintRadiusMeters: number): PropRecipe {
  const h = heightMeters;
  const r = footprintRadiusMeters;
  const blobs: [string, number, number, number, number, number, Color][] = [
    ['baseMass', 0, h * 0.2, 0, r * 0.95, 1.1, COLORS.stoneDark],
    ['lowerSpire', r * 0.06, h * 0.5, -r * 0.04, r * 0.72, 1.4, COLORS.stone],
    ['upperSpire', -r * 0.05, h * 0.78, r * 0.05, r * 0.48, 1.5, COLORS.stoneLight],
    ['tip', r * 0.03, h * 0.94, 0, r * 0.26, 1.3, COLORS.stone],
  ];
  const parts: PropRecipePart[] = blobs.map(([id, x, y, z, radius, squash, color]) => ({
    id,
    shape: 'sphere',
    position: { x, y, z },
    size: { width: radius * 2, height: radius * 2 * squash, depth: radius * 2 },
    color,
  }));
  return { id: 'rockSpire', parts };
}

export function rockSpireParts(heightMeters: number, footprintRadiusMeters: number): PropPartSpec[] {
  return lowerPropRecipe(rockSpireRecipe(heightMeters, footprintRadiusMeters));
}
