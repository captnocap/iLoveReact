import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const rugDef: PropKindDefinition = {
  kind: 'rug',
  label: 'Rug',
  solid: true,
  footprintRadiusMeters: 1.0,
  heightMeters: 0.04,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'soft',
};

const COLORS = {
  base: recipeColor('#7d4f43'),
  pattern: recipeColor('#3a7d80'),
} satisfies Record<string, Color>;

export function rugRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'base', shape: 'box', position: { x: 0, y: 0.02, z: 0 }, size: { width: 2.0, height: 0.04, depth: 1.4 }, color: COLORS.base },
    { id: 'border', shape: 'box', position: { x: 0, y: 0.04, z: 0 }, size: { width: 1.8, height: 0.015, depth: 1.2 }, color: COLORS.pattern },
    { id: 'center', shape: 'box', position: { x: 0, y: 0.045, z: 0 }, size: { width: 1.0, height: 0.015, depth: 0.7 }, color: COLORS.base },
  ];
  return { id: 'rug', parts };
}

export function rugParts(): PropPartSpec[] {
  return lowerPropRecipe(rugRecipe());
}
