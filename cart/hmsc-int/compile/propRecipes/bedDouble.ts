import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const bedDoubleDef: PropKindDefinition = {
  kind: 'bedDouble',
  label: 'Double Bed',
  solid: true,
  footprintRadiusMeters: 1.05,
  footprintDepthMeters: 1.5,
  heightMeters: 0.95,
  tileKind: 'wall',
  trafficControl: 'none',
  seat: { pose: 'lay', seatHeightMeters: 0.48, capacity: 2 },
  coverClass: 'soft',
};

const COLORS = {
  woodDark: recipeColor('#6b4a2e'),
  wood: recipeColor('#8a6240'),
  linen: recipeColor('#ece8dd'),
  blanket: recipeColor('#7d3b4a'),
} satisfies Record<string, Color>;

export function bedDoubleRecipe(): PropRecipe {
  const w = 2.1;
  const d = 1.5;
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
      position: { x: w * 0.49, y: 0.475, z: 0 },
      size: { width: 0.07, height: 0.95, depth: d },
      color: COLORS.wood,
    },
    {
      id: 'leftPillow',
      shape: 'box',
      position: { x: w * 0.36, y: 0.5, z: -d * 0.22 },
      size: { width: w * 0.2, height: 0.1, depth: d * 0.36 },
      color: COLORS.linen,
    },
    {
      id: 'rightPillow',
      shape: 'box',
      position: { x: w * 0.36, y: 0.5, z: d * 0.22 },
      size: { width: w * 0.2, height: 0.1, depth: d * 0.36 },
      color: COLORS.linen,
    },
  ];
  return { id: 'bedDouble', parts };
}

export function bedDoubleParts(): PropPartSpec[] {
  return lowerPropRecipe(bedDoubleRecipe());
}
