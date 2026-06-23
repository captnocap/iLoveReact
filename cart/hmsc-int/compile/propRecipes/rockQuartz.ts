import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const rockQuartzDef: PropKindDefinition = {
  kind: 'rockQuartz',
  label: 'Quartz Rock',
  solid: true,
  footprintRadiusMeters: 0.55,
  heightMeters: 0.9,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  crystal: recipeColor('#e8e6f2'),
  shadow: recipeColor('#c4c2d6'),
  tip: recipeColor('#f4f2ff'),
} satisfies Record<string, Color>;

export function rockQuartzRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'base', shape: 'box', position: { x: 0, y: 0.22, z: 0 }, size: { width: 0.75, height: 0.35, depth: 0.75 }, color: COLORS.shadow, rotation: { pitch: 0, yaw: 20, roll: 0 } },
    { id: 'point1', shape: 'box', position: { x: 0, y: 0.62, z: 0 }, size: { width: 0.38, height: 0.6, depth: 0.38 }, color: COLORS.crystal, rotation: { pitch: -4, yaw: 45, roll: 4 } },
    { id: 'point2', shape: 'box', position: { x: 0.24, y: 0.52, z: 0.2 }, size: { width: 0.24, height: 0.42, depth: 0.24 }, color: COLORS.tip, rotation: { pitch: 6, yaw: -30, roll: -6 } },
    { id: 'point3', shape: 'box', position: { x: -0.2, y: 0.56, z: -0.18 }, size: { width: 0.26, height: 0.48, depth: 0.26 }, color: COLORS.crystal, rotation: { pitch: -5, yaw: 75, roll: 5 } },
    { id: 'point4', shape: 'box', position: { x: 0.18, y: 0.42, z: -0.24 }, size: { width: 0.2, height: 0.34, depth: 0.2 }, color: COLORS.tip, rotation: { pitch: 8, yaw: 10, roll: -10 } },
    { id: 'point5', shape: 'box', position: { x: -0.18, y: 0.38, z: 0.22 }, size: { width: 0.18, height: 0.28, depth: 0.18 }, color: COLORS.shadow, rotation: { pitch: -6, yaw: -60, roll: 8 } },
    { id: 'chip', shape: 'box', position: { x: 0.35, y: 0.18, z: 0.28 }, size: { width: 0.18, height: 0.14, depth: 0.16 }, color: COLORS.shadow, rotation: { pitch: 12, yaw: 35, roll: -6 } },
  ];
  return { id: 'rockQuartz', parts };
}

export function rockQuartzParts(): PropPartSpec[] {
  return lowerPropRecipe(rockQuartzRecipe());
}
