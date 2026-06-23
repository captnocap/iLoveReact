import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const saltShakerDef: PropKindDefinition = {
  kind: 'saltShaker',
  label: 'Salt Shaker',
  solid: true,
  footprintRadiusMeters: 0.04,
  heightMeters: 0.1,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'none',
};

const COLORS = {
  body: recipeColor('#eef0f2'),
  accent: recipeColor('#b2b3b5'),
  detail: recipeColor('#ffffff'),
} satisfies Record<string, Color>;

export function saltShakerRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'base', shape: 'box', position: { x: 0, y: 0.045, z: 0 }, size: { width: 0.056, height: 0.070, depth: 0.040 }, color: COLORS.body },
    { id: 'accent', shape: 'box', position: { x: 0, y: 0.080, z: 0 }, size: { width: 0.040, height: 0.015, depth: 0.032 }, color: COLORS.accent },
    { id: 'detail', shape: 'cylinder8', position: { x: 0.020, y: 0.050, z: 0 }, radius: 0.005, height: 0.040, color: COLORS.detail },
  ];
  return { id: 'saltShaker', parts };
}

export function saltShakerParts(): PropPartSpec[] {
  return lowerPropRecipe(saltShakerRecipe());
}
