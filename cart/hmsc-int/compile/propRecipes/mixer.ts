import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const mixerDef: PropKindDefinition = {
  kind: 'mixer',
  label: 'Mixer',
  solid: true,
  footprintRadiusMeters: 0.12,
  heightMeters: 0.28,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'none',
};

const COLORS = {
  body: recipeColor('#9c2a25'),
  accent: recipeColor('#751f1b'),
  detail: recipeColor('#bb322c'),
} satisfies Record<string, Color>;

export function mixerRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'base', shape: 'box', position: { x: 0, y: 0.126, z: 0 }, size: { width: 0.168, height: 0.196, depth: 0.120 }, color: COLORS.body },
    { id: 'accent', shape: 'box', position: { x: 0, y: 0.224, z: 0 }, size: { width: 0.120, height: 0.042, depth: 0.096 }, color: COLORS.accent },
    { id: 'detail', shape: 'cylinder8', position: { x: 0.060, y: 0.140, z: 0 }, radius: 0.014, height: 0.112, color: COLORS.detail },
  ];
  return { id: 'mixer', parts };
}

export function mixerParts(): PropPartSpec[] {
  return lowerPropRecipe(mixerRecipe());
}
