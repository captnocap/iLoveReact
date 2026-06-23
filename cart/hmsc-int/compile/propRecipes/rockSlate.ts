import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const rockSlateDef: PropKindDefinition = {
  kind: 'rockSlate',
  label: 'Slate Rock',
  solid: true,
  footprintRadiusMeters: 0.65,
  heightMeters: 0.6,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  slab: recipeColor('#52565d'),
  edge: recipeColor('#6b7079'),
  crack: recipeColor('#3a3f46'),
} satisfies Record<string, Color>;

export function rockSlateRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'slab1', shape: 'box', position: { x: 0, y: 0.18, z: 0 }, size: { width: 1.15, height: 0.12, depth: 0.75 }, color: COLORS.slab, rotation: { pitch: 2, yaw: 15, roll: -4 } },
    { id: 'slab2', shape: 'box', position: { x: 0.05, y: 0.28, z: 0.05 }, size: { width: 0.95, height: 0.1, depth: 0.62 }, color: COLORS.edge, rotation: { pitch: -1, yaw: -10, roll: 3 } },
    { id: 'slab3', shape: 'box', position: { x: -0.05, y: 0.38, z: -0.05 }, size: { width: 0.7, height: 0.08, depth: 0.48 }, color: COLORS.slab, rotation: { pitch: 3, yaw: 25, roll: -2 } },
    { id: 'slab4', shape: 'box', position: { x: 0.12, y: 0.48, z: 0.1 }, size: { width: 0.45, height: 0.08, depth: 0.32 }, color: COLORS.edge, rotation: { pitch: -2, yaw: 5, roll: 4 } },
    { id: 'splinter1', shape: 'box', position: { x: 0.55, y: 0.12, z: -0.25 }, size: { width: 0.22, height: 0.06, depth: 0.18 }, color: COLORS.crack, rotation: { pitch: 18, yaw: -40, roll: 8 } },
    { id: 'splinter2', shape: 'box', position: { x: -0.42, y: 0.14, z: 0.22 }, size: { width: 0.2, height: 0.06, depth: 0.16 }, color: COLORS.crack, rotation: { pitch: -12, yaw: 55, roll: -6 } },
  ];
  return { id: 'rockSlate', parts };
}

export function rockSlateParts(): PropPartSpec[] {
  return lowerPropRecipe(rockSlateRecipe());
}
