import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const treeDeadTwistedDef: PropKindDefinition = {
  kind: 'treeDeadTwisted',
  label: 'Twisted Dead Tree',
  solid: true,
  footprintRadiusMeters: 0.35,
  heightMeters: 3.5,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'low',
};

const COLORS = {
  trunk: recipeColor('#6b4a2e'),
  leaf: recipeColor('#5c4a3a'),
  leafDark: recipeColor('#45372b'),
} satisfies Record<string, Color>;

export function treeDeadTwistedRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'trunk', shape: 'cylinder16', position: { x: 0, y: 0.612, z: 0 }, radius: 0.077, height: 1.225, color: COLORS.trunk },
    { id: 'canopyA', shape: 'sphere', position: { x: 0, y: 2.275, z: 0 }, size: { width: 0.630, height: 1.575, depth: 0.630 }, color: COLORS.leaf },
    { id: 'canopyB', shape: 'sphere', position: { x: 0.105, y: 2.625, z: 0.070 }, size: { width: 0.455, height: 1.225, depth: 0.455 }, color: COLORS.leafDark },
    { id: 'canopyC', shape: 'sphere', position: { x: -0.087, y: 1.925, z: -0.052 }, size: { width: 0.420, height: 1.050, depth: 0.420 }, color: COLORS.leafDark },
  ];
  return { id: 'treeDeadTwisted', parts };
}

export function treeDeadTwistedParts(): PropPartSpec[] {
  return lowerPropRecipe(treeDeadTwistedRecipe());
}
