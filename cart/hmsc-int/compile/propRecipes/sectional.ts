import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const sectionalDef: PropKindDefinition = {
  kind: 'sectional',
  label: 'Sectional Sofa',
  solid: true,
  footprintRadiusMeters: 1.4,
  heightMeters: 0.85,
  tileKind: 'wall',
  trafficControl: 'none',
  seat: { pose: 'sit', seatHeightMeters: 0.42, capacity: 4 },
  coverClass: 'soft',
};

const COLORS = {
  cushion: recipeColor('#7d4f43'),
  cushionLight: recipeColor('#96604f'),
} satisfies Record<string, Color>;

export function sectionalRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'mainSeat',
      shape: 'box',
      position: { x: 0, y: 0.4, z: 0 },
      size: { width: 2.2, height: 0.2, depth: 0.9 },
      color: COLORS.cushion,
    },
    {
      id: 'chaiseSeat',
      shape: 'box',
      position: { x: 0.9, y: 0.4, z: 0.9 },
      size: { width: 1.0, height: 0.2, depth: 1.0 },
      color: COLORS.cushionLight,
    },
    {
      id: 'back',
      shape: 'box',
      position: { x: 0, y: 0.62, z: 0.38 },
      size: { width: 2.4, height: 0.5, depth: 0.2 },
      color: COLORS.cushion,
    },
    {
      id: 'armLeft',
      shape: 'box',
      position: { x: -1.15, y: 0.5, z: 0 },
      size: { width: 0.2, height: 0.6, depth: 0.9 },
      color: COLORS.cushionLight,
    },
    {
      id: 'armRight',
      shape: 'box',
      position: { x: 1.35, y: 0.5, z: 0.9 },
      size: { width: 1.0, height: 0.6, depth: 0.2 },
      color: COLORS.cushionLight,
    },
  ];
  return { id: 'sectional', parts };
}

export function sectionalParts(): PropPartSpec[] {
  return lowerPropRecipe(sectionalRecipe());
}
