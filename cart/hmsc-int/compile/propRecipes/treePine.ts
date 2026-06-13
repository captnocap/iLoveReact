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

export function treePineRecipe(kind: string, heightMeters: number, footprintRadiusMeters: number): PropRecipe {
  const h = heightMeters;
  const r = footprintRadiusMeters;
  const parts: PropRecipePart[] = [
    {
      id: 'trunk',
      shape: 'cylinder8',
      position: { x: 0, y: h * 0.16, z: 0 },
      radius: r,
      height: h * 0.32,
      color: COLORS.barkDark,
    },
  ];
  // No cone instance shape -- each canopy tier is two stacked cylinders.
  const tiers: [string, number, number, number, Color][] = [
    ['lower', h * 0.38, h * 0.21, h * 0.36, COLORS.pineDark],
    ['middle', h * 0.6, h * 0.165, h * 0.32, COLORS.pineMid],
    ['upper', h * 0.82, h * 0.115, h * 0.3, COLORS.pineDark],
  ];
  for (const [id, y, tierR, tierH, color] of tiers) {
    parts.push({
      id: `${id}CanopyLower`,
      shape: 'cylinder8',
      position: { x: 0, y: y - tierH * 0.2, z: 0 },
      radius: tierR * 0.85,
      height: tierH * 0.55,
      color,
    });
    parts.push({
      id: `${id}CanopyUpper`,
      shape: 'cylinder8',
      position: { x: 0, y: y + tierH * 0.18, z: 0 },
      radius: tierR * 0.5,
      height: tierH * 0.55,
      color,
    });
  }
  return { id: kind, parts };
}

export function treePineParts(kind: string, heightMeters: number, footprintRadiusMeters: number): PropPartSpec[] {
  return lowerPropRecipe(treePineRecipe(kind, heightMeters, footprintRadiusMeters));
}
