import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const ottomanDef: PropKindDefinition = {
  kind: 'ottoman',
  label: 'Ottoman',
  solid: true,
  footprintRadiusMeters: 0.35,
  heightMeters: 0.42,
  tileKind: 'wall',
  trafficControl: 'none',
  seat: { pose: 'sit', seatHeightMeters: 0.42, capacity: 1 },
  coverClass: 'soft',
};

const COLORS = {
  fabric: recipeColor('#7d4f43'),
  fabricDark: recipeColor('#5c3328'),
} satisfies Record<string, Color>;

export function ottomanRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'base',
      shape: 'box',
      position: { x: 0, y: 0.18, z: 0 },
      size: { width: 0.7, height: 0.36, depth: 0.5 },
      color: COLORS.fabric,
    },
    {
      id: 'top',
      shape: 'box',
      position: { x: 0, y: 0.38, z: 0 },
      size: { width: 0.72, height: 0.06, depth: 0.52 },
      color: COLORS.fabricDark,
    },
    {
      id: 'legFL',
      shape: 'box',
      position: { x: -0.3, y: 0.04, z: 0.2 },
      size: { width: 0.04, height: 0.08, depth: 0.04 },
      color: COLORS.fabricDark,
    },
    {
      id: 'legFR',
      shape: 'box',
      position: { x: 0.3, y: 0.04, z: 0.2 },
      size: { width: 0.04, height: 0.08, depth: 0.04 },
      color: COLORS.fabricDark,
    },
    {
      id: 'legBL',
      shape: 'box',
      position: { x: -0.3, y: 0.04, z: -0.2 },
      size: { width: 0.04, height: 0.08, depth: 0.04 },
      color: COLORS.fabricDark,
    },
    {
      id: 'legBR',
      shape: 'box',
      position: { x: 0.3, y: 0.04, z: -0.2 },
      size: { width: 0.04, height: 0.08, depth: 0.04 },
      color: COLORS.fabricDark,
    },
  ];
  return { id: 'ottoman', parts };
}

export function ottomanParts(): PropPartSpec[] {
  return lowerPropRecipe(ottomanRecipe());
}
