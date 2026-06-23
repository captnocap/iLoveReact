import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const potDef: PropKindDefinition = {
  kind: 'pot',
  label: 'Pot',
  solid: true,
  footprintRadiusMeters: 0.14,
  heightMeters: 0.18,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'none',
};

const COLORS = {
  body: recipeColor('#c2362f'),
  accent: recipeColor('#912823'),
  detail: recipeColor('#e84038'),
} satisfies Record<string, Color>;

export function potRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'base', shape: 'box', position: { x: 0, y: 0.081, z: 0 }, size: { width: 0.196, height: 0.126, depth: 0.140 }, color: COLORS.body },
    { id: 'accent', shape: 'box', position: { x: 0, y: 0.144, z: 0 }, size: { width: 0.140, height: 0.027, depth: 0.112 }, color: COLORS.accent },
    { id: 'detail', shape: 'cylinder8', position: { x: 0.070, y: 0.090, z: 0 }, radius: 0.017, height: 0.072, color: COLORS.detail },
  ];
  return { id: 'pot', parts };
}

export function potParts(): PropPartSpec[] {
  return lowerPropRecipe(potRecipe());
}
