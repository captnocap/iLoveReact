import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const fastFoodMenuDef: PropKindDefinition = {
  kind: 'fastFoodMenu',
  label: 'Fast Food Menu',
  solid: true,
  footprintRadiusMeters: 0.4,
  footprintDepthMeters: 0.04,
  heightMeters: 0.8,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'none',
};

const COLORS = {
  frame: recipeColor('#22262b'),
  board: recipeColor('#eef0f2'),
  text: recipeColor('#b3221c'),
  accent: recipeColor('#d4a83a'),
} satisfies Record<string, Color>;

export function fastFoodMenuRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'frame', shape: 'box', position: { x: 0, y: 0.45, z: -0.02 }, size: { width: 0.8, height: 0.9, depth: 0.04 }, color: COLORS.frame },
    { id: 'board', shape: 'box', position: { x: 0, y: 0.45, z: -0.04 }, size: { width: 0.72, height: 0.78, depth: 0.02 }, color: COLORS.board },
    { id: 'line1', shape: 'box', position: { x: -0.12, y: 0.62, z: -0.055 }, size: { width: 0.4, height: 0.04, depth: 0.01 }, color: COLORS.text },
    { id: 'line2', shape: 'box', position: { x: -0.12, y: 0.48, z: -0.055 }, size: { width: 0.35, height: 0.04, depth: 0.01 }, color: COLORS.text },
    { id: 'line3', shape: 'box', position: { x: -0.12, y: 0.34, z: -0.055 }, size: { width: 0.42, height: 0.04, depth: 0.01 }, color: COLORS.text },
    { id: 'logo', shape: 'box', position: { x: 0.2, y: 0.68, z: -0.055 }, size: { width: 0.16, height: 0.12, depth: 0.01 }, color: COLORS.accent },
    { id: 'topTrim', shape: 'box', position: { x: 0, y: 0.91, z: -0.055 }, size: { width: 0.72, height: 0.04, depth: 0.01 }, color: COLORS.frame },
    { id: 'bottomTrim', shape: 'box', position: { x: 0, y: 0.01, z: -0.055 }, size: { width: 0.72, height: 0.04, depth: 0.01 }, color: COLORS.frame },
    { id: 'mountL', shape: 'box', position: { x: -0.35, y: 0.45, z: 0.02 }, size: { width: 0.04, height: 0.08, depth: 0.04 }, color: COLORS.frame },
    { id: 'mountR', shape: 'box', position: { x: 0.35, y: 0.45, z: 0.02 }, size: { width: 0.04, height: 0.08, depth: 0.04 }, color: COLORS.frame },
  ];
  return { id: 'fastFoodMenu', parts };
}

export function fastFoodMenuParts(): PropPartSpec[] {
  return lowerPropRecipe(fastFoodMenuRecipe());
}
