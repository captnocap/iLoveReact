import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const chalkboardDef: PropKindDefinition = {
  kind: 'chalkboard',
  label: 'Chalkboard',
  solid: true,
  footprintRadiusMeters: 0.1,
  heightMeters: 1.2,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'none',
};

const COLORS = {
  frame: recipeColor('#6b4a2e'),
  board: recipeColor('#2d5a33'),
  chalk: recipeColor('#eef0f2'),
  tray: recipeColor('#6b4a2e'),
} satisfies Record<string, Color>;

export function chalkboardRecipe(): PropRecipe {
  const h = 1.2;
  const parts: PropRecipePart[] = [
    {
      id: 'frame',
      shape: 'box',
      position: { x: 0, y: h * 0.5, z: 0 },
      size: { width: 1.6, height: h, depth: 0.06 },
      color: COLORS.frame,
    },
    {
      id: 'board',
      shape: 'box',
      position: { x: 0, y: h * 0.5, z: -0.03 },
      size: { width: 1.5, height: h * 0.9, depth: 0.03 },
      color: COLORS.board,
    },
    {
      id: 'chalkLine1',
      shape: 'box',
      position: { x: -0.2, y: h * 0.65, z: -0.045 },
      size: { width: 0.6, height: 0.02, depth: 0.01 },
      color: COLORS.chalk,
    },
    {
      id: 'chalkLine2',
      shape: 'box',
      position: { x: 0.1, y: h * 0.45, z: -0.045 },
      size: { width: 0.5, height: 0.02, depth: 0.01 },
      color: COLORS.chalk,
    },
    {
      id: 'tray',
      shape: 'box',
      position: { x: 0, y: h * 0.08, z: -0.05 },
      size: { width: 1.55, height: 0.04, depth: 0.08 },
      color: COLORS.tray,
    },
  ];
  return { id: 'chalkboard', parts };
}

export function chalkboardParts(): PropPartSpec[] {
  return lowerPropRecipe(chalkboardRecipe());
}
