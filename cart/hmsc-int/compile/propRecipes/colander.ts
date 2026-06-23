import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const colanderDef: PropKindDefinition = {
  kind: 'colander',
  label: 'Colander',
  solid: true,
  footprintRadiusMeters: 0.13,
  heightMeters: 0.12,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'none',
};

const COLORS = {
  body: recipeColor('#9aa1ab'),
  accent: recipeColor('#737880'),
  detail: recipeColor('#b8c1cd'),
} satisfies Record<string, Color>;

export function colanderRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'base', shape: 'box', position: { x: 0, y: 0.054, z: 0 }, size: { width: 0.182, height: 0.084, depth: 0.130 }, color: COLORS.body },
    { id: 'accent', shape: 'box', position: { x: 0, y: 0.096, z: 0 }, size: { width: 0.130, height: 0.018, depth: 0.104 }, color: COLORS.accent },
    { id: 'detail', shape: 'cylinder8', position: { x: 0.065, y: 0.060, z: 0 }, radius: 0.016, height: 0.048, color: COLORS.detail },
  ];
  return { id: 'colander', parts };
}

export function colanderParts(): PropPartSpec[] {
  return lowerPropRecipe(colanderRecipe());
}
