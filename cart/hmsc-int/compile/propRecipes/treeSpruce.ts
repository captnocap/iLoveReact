import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const treeSpruceDef: PropKindDefinition = {
  kind: 'treeSpruce',
  label: 'Spruce Tree',
  solid: true,
  footprintRadiusMeters: 0.5,
  heightMeters: 5.5,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'low',
};

const COLORS = {
  trunk: recipeColor('#6b4a2e'),
  leaf: recipeColor('#3a4a30'),
  leafDark: recipeColor('#2b3724'),
} satisfies Record<string, Color>;

export function treeSpruceRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'trunk', shape: 'cylinder16', position: { x: 0, y: 0.962, z: 0 }, radius: 0.110, height: 1.925, color: COLORS.trunk },
    { id: 'canopyA', shape: 'sphere', position: { x: 0, y: 3.575, z: 0 }, size: { width: 0.900, height: 2.475, depth: 0.900 }, color: COLORS.leaf },
    { id: 'canopyB', shape: 'sphere', position: { x: 0.150, y: 4.125, z: 0.100 }, size: { width: 0.650, height: 1.925, depth: 0.650 }, color: COLORS.leafDark },
    { id: 'canopyC', shape: 'sphere', position: { x: -0.125, y: 3.025, z: -0.075 }, size: { width: 0.600, height: 1.650, depth: 0.600 }, color: COLORS.leafDark },
  ];
  return { id: 'treeSpruce', parts };
}

export function treeSpruceParts(): PropPartSpec[] {
  return lowerPropRecipe(treeSpruceRecipe());
}
