import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const treeMapleDef: PropKindDefinition = {
  kind: 'treeMaple',
  label: 'Maple Tree',
  solid: true,
  footprintRadiusMeters: 0.55,
  heightMeters: 5.0,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'low',
};

const COLORS = {
  trunk: recipeColor('#6b4a2e'),
  leaf: recipeColor('#6b4a2e'),
  leafDark: recipeColor('#503722'),
} satisfies Record<string, Color>;

export function treeMapleRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'trunk', shape: 'cylinder16', position: { x: 0, y: 0.875, z: 0 }, radius: 0.121, height: 1.750, color: COLORS.trunk },
    { id: 'canopyA', shape: 'sphere', position: { x: 0, y: 3.250, z: 0 }, size: { width: 0.990, height: 2.250, depth: 0.990 }, color: COLORS.leaf },
    { id: 'canopyB', shape: 'sphere', position: { x: 0.165, y: 3.750, z: 0.110 }, size: { width: 0.715, height: 1.750, depth: 0.715 }, color: COLORS.leafDark },
    { id: 'canopyC', shape: 'sphere', position: { x: -0.138, y: 2.750, z: -0.083 }, size: { width: 0.660, height: 1.500, depth: 0.660 }, color: COLORS.leafDark },
  ];
  return { id: 'treeMaple', parts };
}

export function treeMapleParts(): PropPartSpec[] {
  return lowerPropRecipe(treeMapleRecipe());
}
