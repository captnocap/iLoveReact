import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const plantCactusLargeDef: PropKindDefinition = {
  kind: 'plantCactusLarge',
  label: 'Large Cactus',
  solid: true,
  footprintRadiusMeters: 0.25,
  heightMeters: 1.6,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'low',
};

const COLORS = {
  pot: recipeColor('#8a6240'),
  soil: recipeColor('#3e3226'),
  leaf: recipeColor('#4a6b3a'),
  leafLight: recipeColor('#588045'),
  leafDark: recipeColor('#37512b'),
} satisfies Record<string, Color>;

export function plantCactusLargeRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'pot', shape: 'cylinder16', position: { x: 0, y: 0.176, z: 0 }, radius: 0.175, height: 0.352, color: COLORS.pot },
    { id: 'soil', shape: 'cylinder16', position: { x: 0, y: 0.352, z: 0 }, radius: 0.150, height: 0.030, color: COLORS.soil },
    { id: 'stem', shape: 'cylinder8', position: { x: 0, y: 0.880, z: 0 }, radius: 0.030, height: 1.120, color: COLORS.leaf },
    { id: 'leavesA', shape: 'sphere', position: { x: 0, y: 1.360, z: 0 }, size: { width: 0.350, height: 0.560, depth: 0.350 }, color: COLORS.leaf },
    { id: 'leavesB', shape: 'sphere', position: { x: 0.100, y: 1.040, z: 0.050 }, size: { width: 0.225, height: 0.400, depth: 0.225 }, color: COLORS.leafLight },
    { id: 'leavesC', shape: 'sphere', position: { x: -0.087, y: 1.120, z: -0.037 }, size: { width: 0.212, height: 0.352, depth: 0.212 }, color: COLORS.leafDark },
  ];
  return { id: 'plantCactusLarge', parts };
}

export function plantCactusLargeParts(): PropPartSpec[] {
  return lowerPropRecipe(plantCactusLargeRecipe());
}
