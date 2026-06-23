import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const tvFlatDef: PropKindDefinition = {
  kind: 'tvFlat',
  label: 'Flatscreen TV',
  solid: true,
  footprintRadiusMeters: 0.05,
  heightMeters: 0.65,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'none',
};

const COLORS = {
  frame: recipeColor('#1a1c1e'),
  screen: recipeColor('#2c4a66'),
  stand: recipeColor('#3a3f46'),
} satisfies Record<string, Color>;

export function tvFlatRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'screen',
      shape: 'box',
      position: { x: 0, y: 0.32, z: 0.02 },
      size: { width: 1.1, height: 0.62, depth: 0.04 },
      color: COLORS.screen,
    },
    {
      id: 'bezel',
      shape: 'box',
      position: { x: 0, y: 0.32, z: 0.01 },
      size: { width: 1.16, height: 0.68, depth: 0.03 },
      color: COLORS.frame,
    },
    {
      id: 'back',
      shape: 'box',
      position: { x: 0, y: 0.32, z: 0.04 },
      size: { width: 1.1, height: 0.62, depth: 0.04 },
      color: COLORS.frame,
    },
    {
      id: 'standNeck',
      shape: 'box',
      position: { x: 0, y: -0.02, z: 0.04 },
      size: { width: 0.12, height: 0.06, depth: 0.08 },
      color: COLORS.stand,
    },
    {
      id: 'standBase',
      shape: 'box',
      position: { x: 0, y: -0.05, z: 0.04 },
      size: { width: 0.36, height: 0.02, depth: 0.22 },
      color: COLORS.stand,
    },
  ];
  return { id: 'tvFlat', parts };
}

export function tvFlatParts(): PropPartSpec[] {
  return lowerPropRecipe(tvFlatRecipe());
}
