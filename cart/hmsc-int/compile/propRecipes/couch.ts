import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';

const COLORS = {
  woodDark: recipeColor('#6b4a2e'),
  cushion: recipeColor('#7d4f43'),
  cushionLight: recipeColor('#96604f'),
} satisfies Record<string, Color>;

export function couchRecipe(footprintRadiusMeters: number): PropRecipe {
  const w = footprintRadiusMeters * 2;
  const parts: PropRecipePart[] = [
    {
      id: 'base',
      shape: 'box',
      position: { x: 0, y: 0.18, z: 0 },
      size: { width: w, height: 0.3, depth: 0.85 },
      color: COLORS.woodDark,
    },
    {
      id: 'leftSeatCushion',
      shape: 'box',
      position: { x: -w * 0.225, y: 0.4, z: -0.05 },
      size: { width: w * 0.42, height: 0.16, depth: 0.7 },
      color: COLORS.cushion,
    },
    {
      id: 'rightSeatCushion',
      shape: 'box',
      position: { x: w * 0.225, y: 0.4, z: -0.05 },
      size: { width: w * 0.42, height: 0.16, depth: 0.7 },
      color: COLORS.cushionLight,
    },
    {
      id: 'back',
      shape: 'box',
      position: { x: 0, y: 0.55, z: 0.34 },
      size: { width: w, height: 0.6, depth: 0.22 },
      color: COLORS.cushion,
      rotation: { pitch: -4, yaw: 0, roll: 0 },
    },
    {
      id: 'leftArm',
      shape: 'box',
      position: { x: -w * 0.46, y: 0.45, z: 0 },
      size: { width: w * 0.09, height: 0.55, depth: 0.8 },
      color: COLORS.cushionLight,
    },
    {
      id: 'rightArm',
      shape: 'box',
      position: { x: w * 0.46, y: 0.45, z: 0 },
      size: { width: w * 0.09, height: 0.55, depth: 0.8 },
      color: COLORS.cushionLight,
    },
  ];
  return { id: 'couch', parts };
}

export function couchParts(footprintRadiusMeters: number): PropPartSpec[] {
  return lowerPropRecipe(couchRecipe(footprintRadiusMeters));
}
