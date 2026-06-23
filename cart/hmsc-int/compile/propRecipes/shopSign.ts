import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const shopSignDef: PropKindDefinition = {
  kind: 'shopSign',
  label: 'Shop Blade Sign',
  solid: true,
  footprintRadiusMeters: 0.1,
  heightMeters: 3.0,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'none',
};

const COLORS = {
  bracket: recipeColor('#3a3f46'),
  frame: recipeColor('#1a1c1e'),
  face: recipeColor('#eef0f2'),
  trim: recipeColor('#c2362f'),
} satisfies Record<string, Color>;

export function shopSignRecipe(): PropRecipe {
  const h = 3.0;
  const parts: PropRecipePart[] = [
    {
      id: 'wallMount',
      shape: 'box',
      position: { x: 0, y: h * 0.8, z: 0.05 },
      size: { width: 0.12, height: 0.2, depth: 0.1 },
      color: COLORS.bracket,
    },
    {
      id: 'arm',
      shape: 'box',
      position: { x: 0, y: h * 0.8, z: -0.15 },
      size: { width: 0.06, height: 0.06, depth: 0.4 },
      color: COLORS.bracket,
    },
    {
      id: 'frame',
      shape: 'box',
      position: { x: 0, y: h * 0.6, z: -0.35 },
      size: { width: 0.7, height: 0.9, depth: 0.05 },
      color: COLORS.frame,
    },
    {
      id: 'face',
      shape: 'box',
      position: { x: 0, y: h * 0.6, z: -0.37 },
      size: { width: 0.6, height: 0.75, depth: 0.02 },
      color: COLORS.face,
    },
    {
      id: 'trimTop',
      shape: 'box',
      position: { x: 0, y: h * 0.98, z: -0.37 },
      size: { width: 0.7, height: 0.04, depth: 0.03 },
      color: COLORS.trim,
    },
    {
      id: 'trimBottom',
      shape: 'box',
      position: { x: 0, y: h * 0.22, z: -0.37 },
      size: { width: 0.7, height: 0.04, depth: 0.03 },
      color: COLORS.trim,
    },
  ];
  return { id: 'shopSign', parts };
}

export function shopSignParts(): PropPartSpec[] {
  return lowerPropRecipe(shopSignRecipe());
}
