import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const loveseatDef: PropKindDefinition = {
  kind: 'loveseat',
  label: 'Loveseat',
  solid: true,
  footprintRadiusMeters: 0.75,
  footprintDepthMeters: 0.85,
  heightMeters: 0.85,
  tileKind: 'wall',
  trafficControl: 'none',
  seat: { pose: 'sit', seatHeightMeters: 0.4, capacity: 2 },
  coverClass: 'soft',
};

const COLORS = {
  wood: recipeColor('#6b4a2e'),
  fabric: recipeColor('#7d4f43'),
  fabricLight: recipeColor('#96604f'),
} satisfies Record<string, Color>;

export function loveseatRecipe(): PropRecipe {
  const w = 1.5;
  const d = 0.85;
  const parts: PropRecipePart[] = [
    { id: 'base', shape: 'box', position: { x: 0, y: 0.18, z: 0 }, size: { width: w, height: 0.3, depth: d }, color: COLORS.wood },
    { id: 'leftSeat', shape: 'box', position: { x: -w * 0.22, y: 0.4, z: -0.05 }, size: { width: w * 0.38, height: 0.16, depth: d * 0.7 }, color: COLORS.fabric },
    { id: 'rightSeat', shape: 'box', position: { x: w * 0.22, y: 0.4, z: -0.05 }, size: { width: w * 0.38, height: 0.16, depth: d * 0.7 }, color: COLORS.fabricLight },
    { id: 'back', shape: 'box', position: { x: 0, y: 0.55, z: d * 0.36 }, size: { width: w, height: 0.58, depth: 0.2 }, color: COLORS.fabric, rotation: { pitch: -4, yaw: 0, roll: 0 } },
    { id: 'leftArm', shape: 'box', position: { x: -w * 0.46, y: 0.45, z: 0 }, size: { width: w * 0.1, height: 0.55, depth: d * 0.82 }, color: COLORS.fabricLight },
    { id: 'rightArm', shape: 'box', position: { x: w * 0.46, y: 0.45, z: 0 }, size: { width: w * 0.1, height: 0.55, depth: d * 0.82 }, color: COLORS.fabricLight },
  ];
  return { id: 'loveseat', parts };
}

export function loveseatParts(): PropPartSpec[] {
  return lowerPropRecipe(loveseatRecipe());
}
