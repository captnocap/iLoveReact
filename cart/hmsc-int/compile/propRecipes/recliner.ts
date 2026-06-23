import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const reclinerDef: PropKindDefinition = {
  kind: 'recliner',
  label: 'Recliner',
  solid: true,
  footprintRadiusMeters: 0.55,
  footprintDepthMeters: 0.85,
  heightMeters: 1.05,
  tileKind: 'wall',
  trafficControl: 'none',
  seat: { pose: 'sit', seatHeightMeters: 0.42, capacity: 1 },
  coverClass: 'soft',
};

const COLORS = {
  base: recipeColor('#6b4a2e'),
  fabric: recipeColor('#5a3a4a'),
} satisfies Record<string, Color>;

export function reclinerRecipe(): PropRecipe {
  const w = 1.1;
  const d = 0.85;
  const parts: PropRecipePart[] = [
    { id: 'base', shape: 'box', position: { x: 0, y: 0.2, z: 0 }, size: { width: w * 0.9, height: 0.3, depth: d }, color: COLORS.base },
    { id: 'seat', shape: 'box', position: { x: 0, y: 0.43, z: -0.05 }, size: { width: w * 0.75, height: 0.18, depth: d * 0.55 }, color: COLORS.fabric },
    { id: 'back', shape: 'box', position: { x: 0, y: 0.68, z: d * 0.35 }, size: { width: w * 0.8, height: 0.65, depth: 0.18 }, color: COLORS.fabric, rotation: { pitch: -15, yaw: 0, roll: 0 } },
    { id: 'footrest', shape: 'box', position: { x: 0, y: 0.32, z: -d * 0.42 }, size: { width: w * 0.7, height: 0.12, depth: d * 0.32 }, color: COLORS.fabric, rotation: { pitch: 8, yaw: 0, roll: 0 } },
    { id: 'leftArm', shape: 'box', position: { x: -w * 0.42, y: 0.55, z: 0 }, size: { width: w * 0.12, height: 0.5, depth: d * 0.8 }, color: COLORS.fabric },
    { id: 'rightArm', shape: 'box', position: { x: w * 0.42, y: 0.55, z: 0 }, size: { width: w * 0.12, height: 0.5, depth: d * 0.8 }, color: COLORS.fabric },
  ];
  return { id: 'recliner', parts };
}

export function reclinerParts(): PropPartSpec[] {
  return lowerPropRecipe(reclinerRecipe());
}
