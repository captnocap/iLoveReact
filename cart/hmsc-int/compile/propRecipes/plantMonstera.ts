import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const plantMonsteraDef: PropKindDefinition = {
  kind: 'plantMonstera',
  label: 'Monstera Plant',
  solid: true,
  footprintRadiusMeters: 0.3,
  heightMeters: 0.9,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'low',
};

const COLORS = {
  pot: recipeColor('#8a6240'),
  soil: recipeColor('#3e3226'),
  leaf: recipeColor('#4a7d3a'),
  leafLight: recipeColor('#589545'),
  leafDark: recipeColor('#375e2b'),
} satisfies Record<string, Color>;

export function plantMonsteraRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'pot', shape: 'cylinder16', position: { x: 0, y: 0.099, z: 0 }, radius: 0.210, height: 0.198, color: COLORS.pot },
    { id: 'soil', shape: 'cylinder16', position: { x: 0, y: 0.198, z: 0 }, radius: 0.180, height: 0.030, color: COLORS.soil },
    { id: 'stem', shape: 'cylinder8', position: { x: 0, y: 0.495, z: 0 }, radius: 0.036, height: 0.630, color: COLORS.leaf },
    { id: 'leavesA', shape: 'sphere', position: { x: 0, y: 0.765, z: 0 }, size: { width: 0.420, height: 0.315, depth: 0.420 }, color: COLORS.leaf },
    { id: 'leavesB', shape: 'sphere', position: { x: 0.120, y: 0.585, z: 0.060 }, size: { width: 0.270, height: 0.225, depth: 0.270 }, color: COLORS.leafLight },
    { id: 'leavesC', shape: 'sphere', position: { x: -0.105, y: 0.630, z: -0.045 }, size: { width: 0.255, height: 0.198, depth: 0.255 }, color: COLORS.leafDark },
  ];
  return { id: 'plantMonstera', parts };
}

export function plantMonsteraParts(): PropPartSpec[] {
  return lowerPropRecipe(plantMonsteraRecipe());
}
