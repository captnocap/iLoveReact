import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const treeWillowDef: PropKindDefinition = {
  kind: 'treeWillow',
  label: 'Willow Tree',
  solid: true,
  footprintRadiusMeters: 0.5,
  heightMeters: 4.5,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'low',
};

const COLORS = {
  trunk: recipeColor('#6b4a2e'),
  leaf: recipeColor('#6b4a2e'),
  leafDark: recipeColor('#503722'),
} satisfies Record<string, Color>;

export function treeWillowRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'trunk', shape: 'cylinder16', position: { x: 0, y: 0.787, z: 0 }, radius: 0.110, height: 1.575, color: COLORS.trunk },
    { id: 'canopyA', shape: 'sphere', position: { x: 0, y: 2.925, z: 0 }, size: { width: 0.900, height: 2.025, depth: 0.900 }, color: COLORS.leaf },
    { id: 'canopyB', shape: 'sphere', position: { x: 0.150, y: 3.375, z: 0.100 }, size: { width: 0.650, height: 1.575, depth: 0.650 }, color: COLORS.leafDark },
    { id: 'canopyC', shape: 'sphere', position: { x: -0.125, y: 2.475, z: -0.075 }, size: { width: 0.600, height: 1.350, depth: 0.600 }, color: COLORS.leafDark },
  ];
  return { id: 'treeWillow', parts };
}

export function treeWillowParts(): PropPartSpec[] {
  return lowerPropRecipe(treeWillowRecipe());
}
