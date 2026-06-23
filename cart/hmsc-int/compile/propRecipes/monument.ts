import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const monumentDef: PropKindDefinition = {
  kind: 'monument',
  label: 'Monument',
  solid: true,
  footprintRadiusMeters: 1.2,
  heightMeters: 4.0,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'hard',
};

const COLORS = {
  base: recipeColor('#6b7079'),
  shaft: recipeColor('#82868d'),
  cap: recipeColor('#52565d'),
} satisfies Record<string, Color>;

export function monumentRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'base1', shape: 'box', position: { x: 0, y: 0.15, z: 0 }, size: { width: 2.4, height: 0.3, depth: 2.4 }, color: COLORS.base },
    { id: 'base2', shape: 'box', position: { x: 0, y: 0.45, z: 0 }, size: { width: 2.0, height: 0.3, depth: 2.0 }, color: COLORS.base },
    { id: 'shaft', shape: 'box', position: { x: 0, y: 2.2, z: 0 }, size: { width: 0.9, height: 3.5, depth: 0.9 }, color: COLORS.shaft },
    { id: 'cap', shape: 'box', position: { x: 0, y: 3.95, z: 0 }, size: { width: 1.1, height: 0.4, depth: 1.1 }, color: COLORS.cap },
    { id: 'plaque', shape: 'box', position: { x: 0, y: 1.6, z: -0.46 }, size: { width: 0.5, height: 0.6, depth: 0.03 }, color: COLORS.cap },
  ];
  return { id: 'monument', parts };
}

export function monumentParts(): PropPartSpec[] {
  return lowerPropRecipe(monumentRecipe());
}
