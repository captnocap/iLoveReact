import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const sofaDef: PropKindDefinition = {
  kind: 'sofa',
  label: 'Sofa',
  solid: true,
  footprintRadiusMeters: 1.0,
  footprintDepthMeters: 0.9,
  heightMeters: 0.87,
  tileKind: 'wall',
  trafficControl: 'none',
  seat: { pose: 'sit', seatHeightMeters: 0.42, capacity: 3 },
  coverClass: 'soft',
};

const COLORS = {
  wood: recipeColor('#6b4a2e'),
  fabric: recipeColor('#4a6a8a'),
  fabricLight: recipeColor('#5d7fa3'),
} satisfies Record<string, Color>;

export function sofaRecipe(): PropRecipe {
  const w = 2.0;
  const d = 0.9;
  const parts: PropRecipePart[] = [
    { id: 'base', shape: 'box', position: { x: 0, y: 0.18, z: 0 }, size: { width: w, height: 0.3, depth: d }, color: COLORS.wood },
    { id: 'leftSeat', shape: 'box', position: { x: -w * 0.26, y: 0.42, z: -0.05 }, size: { width: w * 0.27, height: 0.16, depth: d * 0.7 }, color: COLORS.fabric },
    { id: 'midSeat', shape: 'box', position: { x: 0, y: 0.42, z: -0.05 }, size: { width: w * 0.27, height: 0.16, depth: d * 0.7 }, color: COLORS.fabricLight },
    { id: 'rightSeat', shape: 'box', position: { x: w * 0.26, y: 0.42, z: -0.05 }, size: { width: w * 0.27, height: 0.16, depth: d * 0.7 }, color: COLORS.fabric },
    { id: 'back', shape: 'box', position: { x: 0, y: 0.56, z: d * 0.36 }, size: { width: w, height: 0.6, depth: 0.2 }, color: COLORS.fabric, rotation: { pitch: -4, yaw: 0, roll: 0 } },
    { id: 'leftArm', shape: 'box', position: { x: -w * 0.47, y: 0.46, z: 0 }, size: { width: w * 0.08, height: 0.55, depth: d * 0.82 }, color: COLORS.fabricLight },
    { id: 'rightArm', shape: 'box', position: { x: w * 0.47, y: 0.46, z: 0 }, size: { width: w * 0.08, height: 0.55, depth: d * 0.82 }, color: COLORS.fabricLight },
  ];
  return { id: 'sofa', parts };
}

export function sofaParts(): PropPartSpec[] {
  return lowerPropRecipe(sofaRecipe());
}
