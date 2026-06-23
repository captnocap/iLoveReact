import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const coffeeMakerDef: PropKindDefinition = {
  kind: 'coffeeMaker',
  label: 'Coffee Maker',
  solid: true,
  footprintRadiusMeters: 0.15,
  heightMeters: 0.32,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'none',
};

const COLORS = {
  body: recipeColor('#1a1c1e'),
  accent: recipeColor('#131516'),
  detail: recipeColor('#1f2124'),
} satisfies Record<string, Color>;

export function coffeeMakerRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'base', shape: 'box', position: { x: 0, y: 0.144, z: 0 }, size: { width: 0.210, height: 0.224, depth: 0.150 }, color: COLORS.body },
    { id: 'accent', shape: 'box', position: { x: 0, y: 0.256, z: 0 }, size: { width: 0.150, height: 0.048, depth: 0.120 }, color: COLORS.accent },
    { id: 'detail', shape: 'cylinder8', position: { x: 0.075, y: 0.160, z: 0 }, radius: 0.018, height: 0.128, color: COLORS.detail },
  ];
  return { id: 'coffeeMaker', parts };
}

export function coffeeMakerParts(): PropPartSpec[] {
  return lowerPropRecipe(coffeeMakerRecipe());
}
