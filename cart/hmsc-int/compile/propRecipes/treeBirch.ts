import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';

const COLORS = {
  paleBark: recipeColor('#d8d4c8'),
  barkDark: recipeColor('#4a3826'),
  leafPale: recipeColor('#6aa84f'),
  leafLight: recipeColor('#43883a'),
} satisfies Record<string, Color>;

export function treeBirchRecipe(heightMeters: number, footprintRadiusMeters: number): PropRecipe {
  const h = heightMeters;
  const r = footprintRadiusMeters;
  const c = h * 0.22;
  const parts: PropRecipePart[] = [
    {
      id: 'trunk',
      shape: 'cylinder8',
      position: { x: 0, y: h * 0.31, z: 0 },
      radius: r,
      height: h * 0.62,
      color: COLORS.paleBark,
    },
    {
      id: 'lowerBarkStripe',
      shape: 'box',
      position: { x: 0, y: h * 0.18, z: 0 },
      size: { width: r * 2.1, height: h * 0.025, depth: r * 2.1 },
      color: COLORS.barkDark,
    },
    {
      id: 'middleBarkStripe',
      shape: 'box',
      position: { x: 0, y: h * 0.34, z: 0 },
      size: { width: r * 2.1, height: h * 0.025, depth: r * 2.1 },
      color: COLORS.barkDark,
      rotation: { pitch: 0, yaw: 30, roll: 0 },
    },
    {
      id: 'upperBarkStripe',
      shape: 'box',
      position: { x: 0, y: h * 0.5, z: 0 },
      size: { width: r * 2.1, height: h * 0.025, depth: r * 2.1 },
      color: COLORS.barkDark,
      rotation: { pitch: 0, yaw: 60, roll: 0 },
    },
    {
      id: 'mainCanopy',
      shape: 'sphere',
      position: { x: 0, y: h * 0.74, z: 0 },
      size: { width: c * 2, height: c * 2.3, depth: c * 2 },
      color: COLORS.leafPale,
    },
    {
      id: 'rightCanopyLobe',
      shape: 'sphere',
      position: { x: c * 0.55, y: h * 0.68, z: c * 0.3 },
      size: { width: c * 1.2, height: c * 1.4, depth: c * 1.2 },
      color: COLORS.leafLight,
    },
    {
      id: 'leftCanopyLobe',
      shape: 'sphere',
      position: { x: -c * 0.5, y: h * 0.7, z: -c * 0.35 },
      size: { width: c * 1.1, height: c * 1.3, depth: c * 1.1 },
      color: COLORS.leafPale,
    },
  ];
  return { id: 'treeBirch', parts };
}

export function treeBirchParts(heightMeters: number, footprintRadiusMeters: number): PropPartSpec[] {
  return lowerPropRecipe(treeBirchRecipe(heightMeters, footprintRadiusMeters));
}
