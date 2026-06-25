import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const plantCactusDef: PropKindDefinition = {
  kind: 'plantCactus',
  label: 'Cactus',
  solid: true,
  footprintRadiusMeters: 0.12,
  heightMeters: 0.5,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'none',
};

const COLORS = {
  pot: recipeColor('#8a6240'),
  soil: recipeColor('#3e3226'),
  leaf: recipeColor('#4a6b3a'),
  leafLight: recipeColor('#588045'),
  leafDark: recipeColor('#37512b'),
} satisfies Record<string, Color>;

export function plantCactusRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'pot', shape: 'cylinder16', position: { x: 0, y: 0.055, z: 0 }, radius: 0.084, height: 0.110, color: COLORS.pot },
    { id: 'soil', shape: 'cylinder16', position: { x: 0, y: 0.110, z: 0 }, radius: 0.072, height: 0.030, color: COLORS.soil },
    { id: 'stem', shape: 'cylinder8', position: { x: 0, y: 0.275, z: 0 }, radius: 0.014, height: 0.350, color: COLORS.leaf },
    { id: 'leavesA', shape: 'sphere', position: { x: 0, y: 0.425, z: 0 }, size: { width: 0.168, height: 0.175, depth: 0.168 }, color: COLORS.leaf },
    { id: 'leavesB', shape: 'sphere', position: { x: 0.048, y: 0.325, z: 0.024 }, size: { width: 0.108, height: 0.125, depth: 0.108 }, color: COLORS.leafLight },
    { id: 'leavesC', shape: 'sphere', position: { x: -0.042, y: 0.350, z: -0.018 }, size: { width: 0.102, height: 0.110, depth: 0.102 }, color: COLORS.leafDark },
  ];
  return { id: 'plantCactus', parts };
}

export function plantCactusParts(): PropPartSpec[] {
  return lowerPropRecipe(plantCactusRecipe());
}
