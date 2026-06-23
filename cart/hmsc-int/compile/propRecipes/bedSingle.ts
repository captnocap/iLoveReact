import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const bedSingleDef: PropKindDefinition = {
  kind: 'bedSingle',
  label: 'Single Bed',
  solid: true,
  footprintRadiusMeters: 1.05,
  footprintDepthMeters: 1.0,
  heightMeters: 0.9,
  tileKind: 'wall',
  trafficControl: 'none',
  seat: { pose: 'lay', seatHeightMeters: 0.48, capacity: 1 },
  coverClass: 'soft',
};

const COLORS = {
  woodDark: recipeColor('#6b4a2e'),
  wood: recipeColor('#8a6240'),
  linen: recipeColor('#ece8dd'),
  blanket: recipeColor('#3a7d80'),
} satisfies Record<string, Color>;

export function bedSingleRecipe(): PropRecipe {
  const w = 2.1;
  const d = 1.0;
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
      color: COLORS.blanket,
    },
    {
      id: 'headboard',
      shape: 'box',
      position: { x: w * 0.49, y: 0.45, z: 0 },
      size: { width: 0.07, height: 0.9, depth: d },
      color: COLORS.wood,
    },
    {
      id: 'pillow',
      shape: 'box',
      position: { x: w * 0.36, y: 0.5, z: 0 },
      size: { width: w * 0.2, height: 0.1, depth: d * 0.55 },
      color: COLORS.linen,
    },
  ];
  return { id: 'bedSingle', parts };
}

export function bedSingleParts(): PropPartSpec[] {
  return lowerPropRecipe(bedSingleRecipe());
}
