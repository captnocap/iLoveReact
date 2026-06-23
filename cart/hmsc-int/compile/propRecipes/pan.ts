import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const panDef: PropKindDefinition = {
  kind: 'pan',
  label: 'Pan',
  solid: true,
  footprintRadiusMeters: 0.15,
  heightMeters: 0.05,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'none',
};

const COLORS = {
  body: recipeColor('#3a3f46'),
  accent: recipeColor('#2b2f34'),
  detail: recipeColor('#454b54'),
} satisfies Record<string, Color>;

export function panRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'base', shape: 'box', position: { x: 0, y: 0.023, z: 0 }, size: { width: 0.210, height: 0.035, depth: 0.150 }, color: COLORS.body },
    { id: 'accent', shape: 'box', position: { x: 0, y: 0.040, z: 0 }, size: { width: 0.150, height: 0.007, depth: 0.120 }, color: COLORS.accent },
    { id: 'detail', shape: 'cylinder8', position: { x: 0.075, y: 0.025, z: 0 }, radius: 0.018, height: 0.020, color: COLORS.detail },
  ];
  return { id: 'pan', parts };
}

export function panParts(): PropPartSpec[] {
  return lowerPropRecipe(panRecipe());
}
