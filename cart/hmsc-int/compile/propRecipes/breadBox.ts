import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const breadBoxDef: PropKindDefinition = {
  kind: 'breadBox',
  label: 'Bread Box',
  solid: true,
  footprintRadiusMeters: 0.22,
  heightMeters: 0.18,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'none',
};

const COLORS = {
  body: recipeColor('#9c2a25'),
  accent: recipeColor('#751f1b'),
  detail: recipeColor('#bb322c'),
} satisfies Record<string, Color>;

export function breadBoxRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'base', shape: 'box', position: { x: 0, y: 0.081, z: 0 }, size: { width: 0.308, height: 0.126, depth: 0.220 }, color: COLORS.body },
    { id: 'accent', shape: 'box', position: { x: 0, y: 0.144, z: 0 }, size: { width: 0.220, height: 0.027, depth: 0.176 }, color: COLORS.accent },
    { id: 'detail', shape: 'cylinder8', position: { x: 0.110, y: 0.090, z: 0 }, radius: 0.026, height: 0.072, color: COLORS.detail },
  ];
  return { id: 'breadBox', parts };
}

export function breadBoxParts(): PropPartSpec[] {
  return lowerPropRecipe(breadBoxRecipe());
}
