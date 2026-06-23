import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const futonDef: PropKindDefinition = {
  kind: 'futon',
  label: 'Futon',
  solid: true,
  footprintRadiusMeters: 0.95,
  footprintDepthMeters: 1.0,
  heightMeters: 0.8,
  tileKind: 'wall',
  trafficControl: 'none',
  seat: { pose: 'sit', seatHeightMeters: 0.4, capacity: 2 },
  coverClass: 'soft',
};

const COLORS = {
  frame: recipeColor('#6b4a2e'),
  mattress: recipeColor('#7d4f43'),
} satisfies Record<string, Color>;

export function futonRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'seat',
      shape: 'box',
      position: { x: 0, y: 0.35, z: 0 },
      size: { width: 1.8, height: 0.22, depth: 1.0 },
      color: COLORS.mattress,
    },
    {
      id: 'back',
      shape: 'box',
      position: { x: 0.7, y: 0.6, z: 0 },
      size: { width: 0.4, height: 0.5, depth: 1.0 },
      color: COLORS.mattress,
      rotation: { pitch: -15, yaw: 0, roll: 0 },
    },
    {
      id: 'frameLeft',
      shape: 'box',
      position: { x: -0.85, y: 0.2, z: 0 },
      size: { width: 0.08, height: 0.4, depth: 1.0 },
      color: COLORS.frame,
    },
    {
      id: 'frameRight',
      shape: 'box',
      position: { x: 0.85, y: 0.2, z: 0 },
      size: { width: 0.08, height: 0.4, depth: 1.0 },
      color: COLORS.frame,
    },
  ];
  return { id: 'futon', parts };
}

export function futonParts(): PropPartSpec[] {
  return lowerPropRecipe(futonRecipe());
}
