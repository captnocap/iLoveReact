import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';

const COLORS = {
  shell: recipeColor('#d3722c'),
  seam: recipeColor('#2a1c12'),
} satisfies Record<string, Color>;

export function ballBasketballRecipe(footprintRadiusMeters: number): PropRecipe {
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
      id: 'equatorSeam',
      shape: 'cylinder16',
      position: { x: 0, y: R, z: 0 },
      radius: R * 1.01,
      height: R * 0.07,
      color: COLORS.seam,
    },
    {
      id: 'frontBackSeam',
      shape: 'cylinder16',
      position: { x: 0, y: R, z: 0 },
      radius: R * 1.01,
      height: R * 0.07,
      color: COLORS.seam,
      rotation: { pitch: 90, yaw: 0, roll: 0 },
    },
    {
      id: 'sideSeam',
      shape: 'cylinder16',
      position: { x: 0, y: R, z: 0 },
      radius: R * 1.01,
      height: R * 0.07,
      color: COLORS.seam,
      rotation: { pitch: 90, yaw: 90, roll: 0 },
    },
  ];
  return { id: 'ballBasketball', parts };
}

export function ballBasketballParts(footprintRadiusMeters: number): PropPartSpec[] {
  return lowerPropRecipe(ballBasketballRecipe(footprintRadiusMeters));
}
