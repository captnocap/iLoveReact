import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const makeupPaletteDef: PropKindDefinition = {
  kind: 'makeupPalette',
  label: 'Makeup Palette',
  solid: false,
  footprintRadiusMeters: 0.08,
  heightMeters: 0.04,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
  coverClass: 'none',
};

const COLORS = {
  case: recipeColor('#1a1c1e'),
  mirror: recipeColor('#c9ccd1'),
  shadow1: recipeColor('#8a4a32'),
  shadow2: recipeColor('#c27d56'),
  shadow3: recipeColor('#7d4f43'),
  shadow4: recipeColor('#e8b84a'),
} satisfies Record<string, Color>;

export function makeupPaletteRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'base',
      shape: 'box',
      position: { x: 0, y: 0.015, z: 0 },
      size: { width: 0.16, height: 0.03, depth: 0.12 },
      color: COLORS.case,
    },
    {
      id: 'pan1',
      shape: 'cylinder8',
      position: { x: -0.05, y: 0.032, z: -0.03 },
      radius: 0.02,
      height: 0.008,
      color: COLORS.shadow1,
    },
    {
      id: 'pan2',
      shape: 'cylinder8',
      position: { x: 0.05, y: 0.032, z: -0.03 },
      radius: 0.02,
      height: 0.008,
      color: COLORS.shadow2,
    },
    {
      id: 'pan3',
      shape: 'cylinder8',
      position: { x: -0.05, y: 0.032, z: 0.03 },
      radius: 0.02,
      height: 0.008,
      color: COLORS.shadow3,
    },
    {
      id: 'pan4',
      shape: 'cylinder8',
      position: { x: 0.05, y: 0.032, z: 0.03 },
      radius: 0.02,
      height: 0.008,
      color: COLORS.shadow4,
    },
    {
      id: 'lid',
      shape: 'box',
      position: { x: 0, y: 0.055, z: -0.06 },
      size: { width: 0.16, height: 0.02, depth: 0.12 },
      color: COLORS.case,
      rotation: { pitch: 70, yaw: 0, roll: 0 },
    },
    {
      id: 'mirror',
      shape: 'box',
      position: { x: 0, y: 0.065, z: -0.06 },
      size: { width: 0.12, height: 0.005, depth: 0.08 },
      color: COLORS.mirror,
      rotation: { pitch: 70, yaw: 0, roll: 0 },
    },
  ];
  return { id: 'makeupPalette', parts };
}

export function makeupPaletteParts(): PropPartSpec[] {
  return lowerPropRecipe(makeupPaletteRecipe());
}
