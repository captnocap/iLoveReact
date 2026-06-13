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
  wood: recipeColor('#8a6240'),
  linen: recipeColor('#ece8dd'),
  porcelain: recipeColor('#eef0f2'),
  blanketDouble: recipeColor('#7d3b4a'),
  blanketSingle: recipeColor('#3a7d80'),
} satisfies Record<string, Color>;

export function bedRecipe(kind: string, heightMeters: number, footprintRadiusMeters: number): PropRecipe {
  const double = kind === 'bedDouble';
  const w = footprintRadiusMeters * 2;
  const d = double ? 1.5 : 1.0;
  const blanket = double ? COLORS.blanketDouble : COLORS.blanketSingle;
  const parts: PropRecipePart[] = [
    {
      id: 'frame',
      shape: 'box',
      position: { x: 0, y: 0.15, z: 0 },
      size: { width: w, height: 0.3, depth: d },
      color: COLORS.woodDark,
    },
    {
      id: 'mattress',
      shape: 'box',
      position: { x: 0, y: 0.39, z: 0 },
      size: { width: w * 0.97, height: 0.18, depth: d * 0.94 },
      color: COLORS.linen,
    },
    {
      id: 'blanket',
      shape: 'box',
      position: { x: -w * 0.16, y: 0.49, z: 0 },
      size: { width: w * 0.62, height: 0.06, depth: d * 0.96 },
      color: blanket,
    },
    {
      id: 'headboard',
      shape: 'box',
      position: { x: w * 0.49, y: heightMeters / 2, z: 0 },
      size: { width: 0.07, height: heightMeters, depth: d },
      color: COLORS.wood,
    },
  ];
  if (double) {
    parts.push({
      id: 'leftPillow',
      shape: 'box',
      position: { x: w * 0.36, y: 0.5, z: -d * 0.22 },
      size: { width: w * 0.2, height: 0.1, depth: d * 0.36 },
      color: COLORS.porcelain,
    });
    parts.push({
      id: 'rightPillow',
      shape: 'box',
      position: { x: w * 0.36, y: 0.5, z: d * 0.22 },
      size: { width: w * 0.2, height: 0.1, depth: d * 0.36 },
      color: COLORS.porcelain,
    });
  } else {
    parts.push({
      id: 'pillow',
      shape: 'box',
      position: { x: w * 0.36, y: 0.5, z: 0 },
      size: { width: w * 0.2, height: 0.1, depth: d * 0.55 },
      color: COLORS.porcelain,
    });
  }
  return { id: kind, parts };
}

export function bedParts(kind: string, heightMeters: number, footprintRadiusMeters: number): PropPartSpec[] {
  return lowerPropRecipe(bedRecipe(kind, heightMeters, footprintRadiusMeters));
}
