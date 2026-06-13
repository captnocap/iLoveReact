import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';

const COLORS = {
  shell: recipeColor('#f4f1e8'),
  redBand: recipeColor('#e0452f'),
  blueBand: recipeColor('#2f6fe0'),
} satisfies Record<string, Color>;

export function ballBeachRecipe(footprintRadiusMeters: number): PropRecipe {
  const R = footprintRadiusMeters;
  const parts: PropRecipePart[] = [
    {
      id: 'shell',
      shape: 'sphere',
      position: { x: 0, y: R, z: 0 },
      size: { width: R * 2, height: R * 2, depth: R * 2 },
      color: COLORS.shell,
    },
    {
      id: 'redBand',
      shape: 'cylinder16',
      position: { x: 0, y: R, z: 0 },
      radius: R * 1.02,
      height: R * 0.36,
      color: COLORS.redBand,
    },
    {
      id: 'blueBand',
      shape: 'cylinder16',
      position: { x: 0, y: R, z: 0 },
      radius: R * 1.02,
      height: R * 0.36,
      color: COLORS.blueBand,
      rotation: { pitch: 90, yaw: 0, roll: 0 },
    },
  ];
  return { id: 'ballBeach', parts };
}

export function ballBeachParts(footprintRadiusMeters: number): PropPartSpec[] {
  return lowerPropRecipe(ballBeachRecipe(footprintRadiusMeters));
}
