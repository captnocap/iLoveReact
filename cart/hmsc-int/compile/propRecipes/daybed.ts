import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const daybedDef: PropKindDefinition = {
  kind: 'daybed',
  label: 'Daybed',
  solid: true,
  footprintRadiusMeters: 1.0,
  footprintDepthMeters: 1.0,
  heightMeters: 0.75,
  tileKind: 'wall',
  trafficControl: 'none',
  seat: { pose: 'lay', seatHeightMeters: 0.42, capacity: 1 },
  coverClass: 'soft',
};

const COLORS = {
  frame: recipeColor('#8a6240'),
  cushion: recipeColor('#e8e4d9'),
  pillow: recipeColor('#7d3b4a'),
} satisfies Record<string, Color>;

export function daybedRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'base',
      shape: 'box',
      position: { x: 0, y: 0.12, z: 0 },
      size: { width: 2.0, height: 0.24, depth: 1.0 },
      color: COLORS.frame,
    },
    {
      id: 'cushion',
      shape: 'box',
      position: { x: 0, y: 0.3, z: 0 },
      size: { width: 1.95, height: 0.12, depth: 0.95 },
      color: COLORS.cushion,
    },
    {
      id: 'backCushion',
      shape: 'box',
      position: { x: 0.75, y: 0.55, z: 0 },
      size: { width: 0.5, height: 0.4, depth: 0.95 },
      color: COLORS.cushion,
      rotation: { pitch: -10, yaw: 0, roll: 0 },
    },
    {
      id: 'pillow',
      shape: 'box',
      position: { x: -0.7, y: 0.42, z: 0 },
      size: { width: 0.35, height: 0.12, depth: 0.55 },
      color: COLORS.pillow,
    },
  ];
  return { id: 'daybed', parts };
}

export function daybedParts(): PropPartSpec[] {
  return lowerPropRecipe(daybedRecipe());
}
