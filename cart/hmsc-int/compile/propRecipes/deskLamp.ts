import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const deskLampDef: PropKindDefinition = {
  kind: 'deskLamp',
  label: 'Desk Lamp',
  solid: true,
  footprintRadiusMeters: 0.25,
  heightMeters: 0.55,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
  coverClass: 'none',
};

const COLORS = {
  base: recipeColor('#6b4a2e'),
  arm: recipeColor('#9aa1ab'),
  shade: recipeColor('#22262b'),
} satisfies Record<string, Color>;

export function deskLampRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'base', shape: 'box', position: { x: 0, y: 0.02, z: 0 }, size: { width: 0.24, height: 0.04, depth: 0.24 }, color: COLORS.base },
    { id: 'lowerArm', shape: 'box', position: { x: 0, y: 0.22, z: 0 }, size: { width: 0.04, height: 0.4, depth: 0.04 }, color: COLORS.arm, rotation: { pitch: 0, yaw: 0, roll: -10 } },
    { id: 'upperArm', shape: 'box', position: { x: 0.12, y: 0.42, z: 0 }, size: { width: 0.35, height: 0.04, depth: 0.04 }, color: COLORS.arm, rotation: { pitch: 0, yaw: 0, roll: -20 } },
    { id: 'shade', shape: 'box', position: { x: 0.26, y: 0.48, z: 0 }, size: { width: 0.18, height: 0.12, depth: 0.18 }, color: COLORS.shade, rotation: { pitch: 0, yaw: 0, roll: -20 } },
  ];
  return { id: 'deskLamp', parts };
}

export function deskLampParts(): PropPartSpec[] {
  return lowerPropRecipe(deskLampRecipe());
}
