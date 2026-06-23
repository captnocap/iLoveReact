import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const clockDef: PropKindDefinition = {
  kind: 'clock',
  label: 'Clock',
  solid: true,
  footprintRadiusMeters: 0.25,
  footprintDepthMeters: 0.1,
  heightMeters: 0.6,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'none',
};

const COLORS = {
  frame: recipeColor('#6b4a2e'),
  face: recipeColor('#eef0f2'),
  hand: recipeColor('#22262b'),
} satisfies Record<string, Color>;

export function clockRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'frame', shape: 'box', position: { x: 0, y: 0.35, z: -0.04 }, size: { width: 0.5, height: 0.5, depth: 0.06 }, color: COLORS.frame },
    { id: 'face', shape: 'box', position: { x: 0, y: 0.35, z: -0.075 }, size: { width: 0.4, height: 0.4, depth: 0.01 }, color: COLORS.face },
    { id: 'handH', shape: 'box', position: { x: 0, y: 0.38, z: -0.085 }, size: { width: 0.03, height: 0.14, depth: 0.01 }, color: COLORS.hand },
    { id: 'handM', shape: 'box', position: { x: 0, y: 0.4, z: -0.085 }, size: { width: 0.02, height: 0.18, depth: 0.01 }, color: COLORS.hand, rotation: { pitch: 0, yaw: 0, roll: -25 } },
  ];
  return { id: 'clock', parts };
}

export function clockParts(): PropPartSpec[] {
  return lowerPropRecipe(clockRecipe());
}
