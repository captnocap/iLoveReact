import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const plantSucculentDef: PropKindDefinition = {
  kind: 'plantSucculent',
  label: 'Succulent Plant',
  solid: true,
  footprintRadiusMeters: 0.1,
  heightMeters: 0.15,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'none',
};

const COLORS = {
  pot: recipeColor('#8a6240'),
  soil: recipeColor('#3e3226'),
  leaf: recipeColor('#6b8a5a'),
  leafLight: recipeColor('#80a56c'),
} satisfies Record<string, Color>;

export function plantSucculentRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'pot', shape: 'cylinder16', position: { x: 0, y: 0.017, z: 0 }, radius: 0.070, height: 0.033, color: COLORS.pot },
    { id: 'soil', shape: 'cylinder16', position: { x: 0, y: 0.033, z: 0 }, radius: 0.060, height: 0.030, color: COLORS.soil },
    { id: 'stem', shape: 'cylinder8', position: { x: 0, y: 0.083, z: 0 }, radius: 0.012, height: 0.105, color: COLORS.leaf },
    { id: 'leavesA', shape: 'sphere', position: { x: 0, y: 0.128, z: 0 }, size: { width: 0.140, height: 0.052, depth: 0.140 }, color: COLORS.leaf },
    { id: 'leavesB', shape: 'sphere', position: { x: 0.040, y: 0.098, z: 0.020 }, size: { width: 0.090, height: 0.037, depth: 0.090 }, color: COLORS.leafLight },
    { id: 'leavesC', shape: 'sphere', position: { x: -0.035, y: 0.105, z: -0.015 }, size: { width: 0.085, height: 0.033, depth: 0.085 }, color: COLORS.leafDark },
  ];
  return { id: 'plantSucculent', parts };
}

export function plantSucculentParts(): PropPartSpec[] {
  return lowerPropRecipe(plantSucculentRecipe());
}
