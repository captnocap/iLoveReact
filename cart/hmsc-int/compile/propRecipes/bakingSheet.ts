import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const bakingSheetDef: PropKindDefinition = {
  kind: 'bakingSheet',
  label: 'Baking Sheet',
  solid: true,
  footprintRadiusMeters: 0.2,
  heightMeters: 0.02,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'none',
};

const COLORS = {
  body: recipeColor('#3a3f46'),
  accent: recipeColor('#2b2f34'),
  detail: recipeColor('#454b54'),
} satisfies Record<string, Color>;

export function bakingSheetRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'base', shape: 'box', position: { x: 0, y: 0.009, z: 0 }, size: { width: 0.280, height: 0.014, depth: 0.200 }, color: COLORS.body },
    { id: 'accent', shape: 'box', position: { x: 0, y: 0.016, z: 0 }, size: { width: 0.200, height: 0.003, depth: 0.160 }, color: COLORS.accent },
    { id: 'detail', shape: 'cylinder8', position: { x: 0.100, y: 0.010, z: 0 }, radius: 0.024, height: 0.008, color: COLORS.detail },
  ];
  return { id: 'bakingSheet', parts };
}

export function bakingSheetParts(): PropPartSpec[] {
  return lowerPropRecipe(bakingSheetRecipe());
}
