import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const chaiseLoungeDef: PropKindDefinition = {
  kind: 'chaiseLounge',
  label: 'Chaise Lounge',
  solid: true,
  footprintRadiusMeters: 0.95,
  footprintDepthMeters: 0.85,
  heightMeters: 0.75,
  tileKind: 'wall',
  trafficControl: 'none',
  seat: { pose: 'lay', seatHeightMeters: 0.38, capacity: 1 },
  coverClass: 'soft',
};

const COLORS = {
  wood: recipeColor('#6b4a2e'),
  fabric: recipeColor('#8a6a4a'),
} satisfies Record<string, Color>;

export function chaiseLoungeRecipe(): PropRecipe {
  const w = 1.9;
  const d = 0.85;
  const parts: PropRecipePart[] = [
    { id: 'base', shape: 'box', position: { x: 0, y: 0.18, z: 0 }, size: { width: w, height: 0.3, depth: d }, color: COLORS.wood },
    { id: 'seat', shape: 'box', position: { x: w * 0.15, y: 0.4, z: -0.05 }, size: { width: w * 0.65, height: 0.16, depth: d * 0.7 }, color: COLORS.fabric },
    { id: 'back', shape: 'box', position: { x: -w * 0.36, y: 0.55, z: d * 0.32 }, size: { width: w * 0.22, height: 0.6, depth: 0.18 }, color: COLORS.fabric, rotation: { pitch: -25, yaw: 0, roll: 0 } },
    { id: 'headrest', shape: 'box', position: { x: -w * 0.4, y: 0.68, z: -0.05 }, size: { width: w * 0.12, height: 0.18, depth: d * 0.7 }, color: COLORS.fabric },
  ];
  return { id: 'chaiseLounge', parts };
}

export function chaiseLoungeParts(): PropPartSpec[] {
  return lowerPropRecipe(chaiseLoungeRecipe());
}
