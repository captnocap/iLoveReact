import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const fruitBowlDef: PropKindDefinition = {
  kind: 'fruitBowl',
  label: 'Fruit Bowl',
  solid: true,
  footprintRadiusMeters: 0.14,
  heightMeters: 0.1,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'none',
};

const COLORS = {
  body: recipeColor('#8a4a32'),
  accent: recipeColor('#673725'),
  detail: recipeColor('#a5583c'),
} satisfies Record<string, Color>;

export function fruitBowlRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'base', shape: 'box', position: { x: 0, y: 0.045, z: 0 }, size: { width: 0.196, height: 0.070, depth: 0.140 }, color: COLORS.body },
    { id: 'accent', shape: 'box', position: { x: 0, y: 0.080, z: 0 }, size: { width: 0.140, height: 0.015, depth: 0.112 }, color: COLORS.accent },
    { id: 'detail', shape: 'cylinder8', position: { x: 0.070, y: 0.050, z: 0 }, radius: 0.017, height: 0.040, color: COLORS.detail },
  ];
  return { id: 'fruitBowl', parts };
}

export function fruitBowlParts(): PropPartSpec[] {
  return lowerPropRecipe(fruitBowlRecipe());
}
