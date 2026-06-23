import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const plantPalmDef: PropKindDefinition = {
  kind: 'plantPalm',
  label: 'Palm Plant',
  solid: true,
  footprintRadiusMeters: 0.35,
  heightMeters: 1.4,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'low',
};

const COLORS = {
  pot: recipeColor('#8a6240'),
  soil: recipeColor('#3e3226'),
  leaf: recipeColor('#5a7d3a'),
  leafLight: recipeColor('#6c9545'),
} satisfies Record<string, Color>;

export function plantPalmRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'pot', shape: 'cylinder16', position: { x: 0, y: 0.154, z: 0 }, radius: 0.245, height: 0.308, color: COLORS.pot },
    { id: 'soil', shape: 'cylinder16', position: { x: 0, y: 0.308, z: 0 }, radius: 0.210, height: 0.030, color: COLORS.soil },
    { id: 'stem', shape: 'cylinder8', position: { x: 0, y: 0.770, z: 0 }, radius: 0.042, height: 0.980, color: COLORS.leaf },
    { id: 'leavesA', shape: 'sphere', position: { x: 0, y: 1.190, z: 0 }, size: { width: 0.490, height: 0.490, depth: 0.490 }, color: COLORS.leaf },
    { id: 'leavesB', shape: 'sphere', position: { x: 0.140, y: 0.910, z: 0.070 }, size: { width: 0.315, height: 0.350, depth: 0.315 }, color: COLORS.leafLight },
    { id: 'leavesC', shape: 'sphere', position: { x: -0.122, y: 0.980, z: -0.052 }, size: { width: 0.297, height: 0.308, depth: 0.297 }, color: COLORS.leafDark },
  ];
  return { id: 'plantPalm', parts };
}

export function plantPalmParts(): PropPartSpec[] {
  return lowerPropRecipe(plantPalmRecipe());
}
