import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const treeAcaciaDef: PropKindDefinition = {
  kind: 'treeAcacia',
  label: 'Acacia Tree',
  solid: true,
  footprintRadiusMeters: 0.45,
  heightMeters: 4.0,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'low',
};

const COLORS = {
  trunk: recipeColor('#6b4a2e'),
  leaf: recipeColor('#6b4a2e'),
  leafDark: recipeColor('#503722'),
} satisfies Record<string, Color>;

export function treeAcaciaRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'trunk', shape: 'cylinder16', position: { x: 0, y: 0.700, z: 0 }, radius: 0.099, height: 1.400, color: COLORS.trunk },
    { id: 'canopyA', shape: 'sphere', position: { x: 0, y: 2.600, z: 0 }, size: { width: 0.810, height: 1.800, depth: 0.810 }, color: COLORS.leaf },
    { id: 'canopyB', shape: 'sphere', position: { x: 0.135, y: 3.000, z: 0.090 }, size: { width: 0.585, height: 1.400, depth: 0.585 }, color: COLORS.leafDark },
    { id: 'canopyC', shape: 'sphere', position: { x: -0.113, y: 2.200, z: -0.068 }, size: { width: 0.540, height: 1.200, depth: 0.540 }, color: COLORS.leafDark },
  ];
  return { id: 'treeAcacia', parts };
}

export function treeAcaciaParts(): PropPartSpec[] {
  return lowerPropRecipe(treeAcaciaRecipe());
}
