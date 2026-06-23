import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const coatRackDef: PropKindDefinition = {
  kind: 'coatRack',
  label: 'Coat Rack',
  solid: true,
  footprintRadiusMeters: 0.35,
  heightMeters: 1.8,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'none',
};

const COLORS = {
  wood: recipeColor('#6b4a2e'),
  hook: recipeColor('#9aa1ab'),
} satisfies Record<string, Color>;

export function coatRackRecipe(): PropRecipe {
  const h = 1.8;
  const parts: PropRecipePart[] = [
    { id: 'base', shape: 'box', position: { x: 0, y: 0.03, z: 0 }, size: { width: 0.45, height: 0.06, depth: 0.45 }, color: COLORS.wood },
    { id: 'pole', shape: 'box', position: { x: 0, y: h / 2, z: 0 }, size: { width: 0.05, height: h, depth: 0.05 }, color: COLORS.wood },
    { id: 'hook1', shape: 'box', position: { x: 0.14, y: h * 0.78, z: 0 }, size: { width: 0.18, height: 0.03, depth: 0.03 }, color: COLORS.hook, rotation: { pitch: 0, yaw: 0, roll: 12 } },
    { id: 'hook2', shape: 'box', position: { x: -0.14, y: h * 0.72, z: 0 }, size: { width: 0.18, height: 0.03, depth: 0.03 }, color: COLORS.hook, rotation: { pitch: 0, yaw: 0, roll: -12 } },
    { id: 'hook3', shape: 'box', position: { x: 0, y: h * 0.85, z: 0.14 }, size: { width: 0.03, height: 0.03, depth: 0.18 }, color: COLORS.hook, rotation: { pitch: -12, yaw: 0, roll: 0 } },
  ];
  return { id: 'coatRack', parts };
}

export function coatRackParts(): PropPartSpec[] {
  return lowerPropRecipe(coatRackRecipe());
}
