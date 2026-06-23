import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const rockCoralDef: PropKindDefinition = {
  kind: 'rockCoral',
  label: 'Coral Rock',
  solid: true,
  footprintRadiusMeters: 0.6,
  heightMeters: 0.9,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  base: recipeColor('#b9a6a0'),
  hole: recipeColor('#8a7a72'),
  ridge: recipeColor('#cbbab2'),
} satisfies Record<string, Color>;

export function rockCoralRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'base', shape: 'box', position: { x: 0, y: 0.32, z: 0 }, size: { width: 1.0, height: 0.55, depth: 0.85 }, color: COLORS.base, rotation: { pitch: 2, yaw: 12, roll: -3 } },
    { id: 'lobe1', shape: 'box', position: { x: 0.28, y: 0.62, z: 0.15 }, size: { width: 0.48, height: 0.32, depth: 0.42 }, color: COLORS.ridge, rotation: { pitch: -5, yaw: -20, roll: 8 } },
    { id: 'lobe2', shape: 'box', position: { x: -0.22, y: 0.72, z: -0.12 }, size: { width: 0.42, height: 0.45, depth: 0.36 }, color: COLORS.base, rotation: { pitch: 6, yaw: 25, roll: -4 } },
    { id: 'lobe3', shape: 'box', position: { x: 0.05, y: 0.82, z: 0.28 }, size: { width: 0.36, height: 0.28, depth: 0.3 }, color: COLORS.ridge, rotation: { pitch: -8, yaw: 55, roll: 10 } },
    { id: 'hole1', shape: 'box', position: { x: 0.12, y: 0.45, z: 0.42 }, size: { width: 0.22, height: 0.18, depth: 0.05 }, color: COLORS.hole, rotation: { pitch: 0, yaw: -10, roll: 0 } },
    { id: 'hole2', shape: 'box', position: { x: -0.25, y: 0.38, z: 0.28 }, size: { width: 0.16, height: 0.14, depth: 0.05 }, color: COLORS.hole, rotation: { pitch: 2, yaw: 30, roll: -2 } },
    { id: 'chip', shape: 'box', position: { x: 0.35, y: 0.18, z: -0.3 }, size: { width: 0.28, height: 0.16, depth: 0.24 }, color: COLORS.hole, rotation: { pitch: 14, yaw: -45, roll: 6 } },
  ];
  return { id: 'rockCoral', parts };
}

export function rockCoralParts(): PropPartSpec[] {
  return lowerPropRecipe(rockCoralRecipe());
}
