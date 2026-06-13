import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';

const COLORS = {
  barkDark: recipeColor('#4a3826'),
  pineDark: recipeColor('#1d3d24'),
  pineMid: recipeColor('#26512e'),
} satisfies Record<string, Color>;

export function treeCypressRecipe(heightMeters: number, footprintRadiusMeters: number): PropRecipe {
  const h = heightMeters;
  const r = footprintRadiusMeters;
  const parts: PropRecipePart[] = [
    {
      id: 'trunk',
      shape: 'cylinder8',
      position: { x: 0, y: h * 0.07, z: 0 },
      radius: r * 0.6,
      height: h * 0.14,
      color: COLORS.barkDark,
    },
    {
      id: 'mainColumnCanopy',
      shape: 'sphere',
      position: { x: 0, y: h * 0.5, z: 0 },
      size: { width: h * 0.26, height: h * 0.84, depth: h * 0.26 },
      color: COLORS.pineDark,
    },
    {
      id: 'offsetColumnCanopy',
      shape: 'sphere',
      position: { x: h * 0.04, y: h * 0.4, z: -h * 0.03 },
      size: { width: h * 0.22, height: h * 0.6, depth: h * 0.22 },
      color: COLORS.pineMid,
    },
    {
      id: 'topColumnCanopy',
      shape: 'sphere',
      position: { x: 0, y: h * 0.78, z: 0 },
      size: { width: h * 0.18, height: h * 0.44, depth: h * 0.18 },
      color: COLORS.pineMid,
    },
  ];
  return { id: 'treeCypress', parts };
}

export function treeCypressParts(heightMeters: number, footprintRadiusMeters: number): PropPartSpec[] {
  return lowerPropRecipe(treeCypressRecipe(heightMeters, footprintRadiusMeters));
}
