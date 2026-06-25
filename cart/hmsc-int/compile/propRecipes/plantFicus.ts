import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const plantFicusDef: PropKindDefinition = {
  kind: 'plantFicus',
  label: 'Ficus Plant',
  solid: true,
  footprintRadiusMeters: 0.3,
  heightMeters: 1.0,
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

export function plantFicusRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'pot', shape: 'cylinder16', position: { x: 0, y: 0.110, z: 0 }, radius: 0.210, height: 0.220, color: COLORS.pot },
    { id: 'soil', shape: 'cylinder16', position: { x: 0, y: 0.220, z: 0 }, radius: 0.180, height: 0.030, color: COLORS.soil },
    { id: 'stem', shape: 'cylinder8', position: { x: 0, y: 0.550, z: 0 }, radius: 0.036, height: 0.700, color: COLORS.leaf },
    { id: 'leavesA', shape: 'sphere', position: { x: 0, y: 0.850, z: 0 }, size: { width: 0.420, height: 0.350, depth: 0.420 }, color: COLORS.leaf },
    { id: 'leavesB', shape: 'sphere', position: { x: 0.120, y: 0.650, z: 0.060 }, size: { width: 0.270, height: 0.250, depth: 0.270 }, color: COLORS.leafLight },
    { id: 'leavesC', shape: 'sphere', position: { x: -0.105, y: 0.700, z: -0.045 }, size: { width: 0.255, height: 0.220, depth: 0.255 }, color: COLORS.leafDark },
  ];
  return { id: 'plantFicus', parts };
}

export function plantFicusParts(): PropPartSpec[] {
  return lowerPropRecipe(plantFicusRecipe());
}
