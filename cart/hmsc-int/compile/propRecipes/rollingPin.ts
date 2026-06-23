import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const rollingPinDef: PropKindDefinition = {
  kind: 'rollingPin',
  label: 'Rolling Pin',
  solid: true,
  footprintRadiusMeters: 0.06,
  heightMeters: 0.04,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'none',
};

const COLORS = {
  body: recipeColor('#8a6240'),
  accent: recipeColor('#674930'),
  detail: recipeColor('#a5754c'),
} satisfies Record<string, Color>;

export function rollingPinRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'base', shape: 'box', position: { x: 0, y: 0.018, z: 0 }, size: { width: 0.084, height: 0.028, depth: 0.060 }, color: COLORS.body },
    { id: 'accent', shape: 'box', position: { x: 0, y: 0.032, z: 0 }, size: { width: 0.060, height: 0.006, depth: 0.048 }, color: COLORS.accent },
    { id: 'detail', shape: 'cylinder8', position: { x: 0.030, y: 0.020, z: 0 }, radius: 0.007, height: 0.016, color: COLORS.detail },
  ];
  return { id: 'rollingPin', parts };
}

export function rollingPinParts(): PropPartSpec[] {
  return lowerPropRecipe(rollingPinRecipe());
}
