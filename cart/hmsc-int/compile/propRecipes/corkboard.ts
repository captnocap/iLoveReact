import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const corkboardDef: PropKindDefinition = {
  kind: 'corkboard',
  label: 'Corkboard',
  solid: true,
  footprintRadiusMeters: 0.1,
  heightMeters: 1.0,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'none',
};

const COLORS = {
  frame: recipeColor('#6b4a2e'),
  cork: recipeColor('#c2a878'),
  paper: recipeColor('#eef0f2'),
  pin: recipeColor('#c2362f'),
} satisfies Record<string, Color>;

export function corkboardRecipe(): PropRecipe {
  const h = 1.0;
  const parts: PropRecipePart[] = [
    {
      id: 'frame',
      shape: 'box',
      position: { x: 0, y: h * 0.5, z: 0 },
      size: { width: 1.0, height: h, depth: 0.04 },
      color: COLORS.frame,
    },
    {
      id: 'cork',
      shape: 'box',
      position: { x: 0, y: h * 0.5, z: -0.02 },
      size: { width: 0.92, height: h * 0.9, depth: 0.02 },
      color: COLORS.cork,
    },
    {
      id: 'paper1',
      shape: 'box',
      position: { x: -0.15, y: h * 0.65, z: -0.03 },
      size: { width: 0.2, height: 0.18, depth: 0.01 },
      color: COLORS.paper,
      rotation: { pitch: 0, yaw: 0, roll: -5 },
    },
    {
      id: 'pin1',
      shape: 'sphere',
      position: { x: -0.15, y: h * 0.75, z: -0.035 },
      size: { width: 0.02, height: 0.02, depth: 0.02 },
      color: COLORS.pin,
    },
    {
      id: 'paper2',
      shape: 'box',
      position: { x: 0.18, y: h * 0.4, z: -0.03 },
      size: { width: 0.22, height: 0.15, depth: 0.01 },
      color: COLORS.paper,
      rotation: { pitch: 0, yaw: 0, roll: 8 },
    },
    {
      id: 'pin2',
      shape: 'sphere',
      position: { x: 0.18, y: h * 0.48, z: -0.035 },
      size: { width: 0.02, height: 0.02, depth: 0.02 },
      color: COLORS.pin,
    },
  ];
  return { id: 'corkboard', parts };
}

export function corkboardParts(): PropPartSpec[] {
  return lowerPropRecipe(corkboardRecipe());
}
