import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const planterBoxDef: PropKindDefinition = {
  kind: 'planterBox',
  label: 'Planter Box',
  solid: true,
  footprintRadiusMeters: 0.4,
  heightMeters: 0.45,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  pot: recipeColor('#8a6240'),
  soil: recipeColor('#3e3226'),
  leaf: recipeColor('#6b4a2e'),
  leafLight: recipeColor('#805837'),
  leafDark: recipeColor('#4e351f'),
} satisfies Record<string, Color>;

export function planterBoxRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'pot', shape: 'cylinder16', position: { x: 0, y: 0.050, z: 0 }, radius: 0.280, height: 0.099, color: COLORS.pot },
    { id: 'soil', shape: 'cylinder16', position: { x: 0, y: 0.099, z: 0 }, radius: 0.240, height: 0.030, color: COLORS.soil },
    { id: 'stem', shape: 'cylinder8', position: { x: 0, y: 0.248, z: 0 }, radius: 0.048, height: 0.315, color: COLORS.leaf },
    { id: 'leavesA', shape: 'sphere', position: { x: 0, y: 0.383, z: 0 }, size: { width: 0.560, height: 0.158, depth: 0.560 }, color: COLORS.leaf },
    { id: 'leavesB', shape: 'sphere', position: { x: 0.160, y: 0.293, z: 0.080 }, size: { width: 0.360, height: 0.113, depth: 0.360 }, color: COLORS.leafLight },
    { id: 'leavesC', shape: 'sphere', position: { x: -0.140, y: 0.315, z: -0.060 }, size: { width: 0.340, height: 0.099, depth: 0.340 }, color: COLORS.leafDark },
  ];
  return { id: 'planterBox', parts };
}

export function planterBoxParts(): PropPartSpec[] {
  return lowerPropRecipe(planterBoxRecipe());
}
