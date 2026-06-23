import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const toiletDef: PropKindDefinition = {
  kind: 'toilet',
  label: 'Toilet',
  solid: true,
  footprintRadiusMeters: 0.32,
  heightMeters: 0.8,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'soft',
};

const COLORS = {
  porcelain: recipeColor('#eef0f2'),
  water: recipeColor('#2c4a66'),
} satisfies Record<string, Color>;

export function toiletRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'bowl', shape: 'cylinder8', position: { x: 0, y: 0.32, z: 0.08 }, radius: 0.28, height: 0.42, color: COLORS.porcelain },
    { id: 'seat', shape: 'cylinder8', position: { x: 0, y: 0.56, z: 0.08 }, radius: 0.24, height: 0.04, color: COLORS.porcelain },
    { id: 'lid', shape: 'cylinder8', position: { x: 0, y: 0.62, z: 0.08 }, radius: 0.23, height: 0.04, color: COLORS.porcelain },
    { id: 'tank', shape: 'box', position: { x: 0, y: 0.55, z: -0.22 }, size: { width: 0.48, height: 0.34, depth: 0.22 }, color: COLORS.porcelain },
    { id: 'flush', shape: 'box', position: { x: 0, y: 0.72, z: -0.32 }, size: { width: 0.1, height: 0.04, depth: 0.03 }, color: COLORS.water },
  ];
  return { id: 'toilet', parts };
}

export function toiletParts(): PropPartSpec[] {
  return lowerPropRecipe(toiletRecipe());
}
