import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const treeCherryDef: PropKindDefinition = {
  kind: 'treeCherry',
  label: 'Cherry Tree',
  solid: true,
  footprintRadiusMeters: 0.4,
  heightMeters: 3.5,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'low',
};

const COLORS = {
  trunk: recipeColor('#6b4a2e'),
  leaf: recipeColor('#6b4a2e'),
  leafDark: recipeColor('#503722'),
} satisfies Record<string, Color>;

export function treeCherryRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'trunk', shape: 'cylinder16', position: { x: 0, y: 0.612, z: 0 }, radius: 0.088, height: 1.225, color: COLORS.trunk },
    { id: 'canopyA', shape: 'sphere', position: { x: 0, y: 2.275, z: 0 }, size: { width: 0.720, height: 1.575, depth: 0.720 }, color: COLORS.leaf },
    { id: 'canopyB', shape: 'sphere', position: { x: 0.120, y: 2.625, z: 0.080 }, size: { width: 0.520, height: 1.225, depth: 0.520 }, color: COLORS.leafDark },
    { id: 'canopyC', shape: 'sphere', position: { x: -0.100, y: 1.925, z: -0.060 }, size: { width: 0.480, height: 1.050, depth: 0.480 }, color: COLORS.leafDark },
  ];
  return { id: 'treeCherry', parts };
}

export function treeCherryParts(): PropPartSpec[] {
  return lowerPropRecipe(treeCherryRecipe());
}
