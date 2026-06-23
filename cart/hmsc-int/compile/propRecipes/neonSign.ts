import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const neonSignDef: PropKindDefinition = {
  kind: 'neonSign',
  label: 'Neon Sign',
  solid: true,
  footprintRadiusMeters: 0.4,
  footprintDepthMeters: 0.02,
  heightMeters: 0.4,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'none',
};

const COLORS = {
  back: recipeColor('#22262b'),
  tube: recipeColor('#ff4d6d'),
} satisfies Record<string, Color>;

export function neonSignRecipe(): PropRecipe {
  const w = 0.8;
  const h = 0.4;
  const parts: PropRecipePart[] = [
    { id: 'back', shape: 'box', position: { x: 0, y: h / 2, z: -0.01 }, size: { width: w, height: h, depth: 0.02 }, color: COLORS.back },
    { id: 'topTube', shape: 'box', position: { x: 0, y: h * 0.78, z: -0.02 }, size: { width: w * 0.85, height: 0.03, depth: 0.02 }, color: COLORS.tube },
    { id: 'bottomTube', shape: 'box', position: { x: 0, y: h * 0.22, z: -0.02 }, size: { width: w * 0.85, height: 0.03, depth: 0.02 }, color: COLORS.tube },
    { id: 'leftTube', shape: 'box', position: { x: -w * 0.4, y: h / 2, z: -0.02 }, size: { width: 0.03, height: h * 0.55, depth: 0.02 }, color: COLORS.tube },
    { id: 'rightTube', shape: 'box', position: { x: w * 0.4, y: h / 2, z: -0.02 }, size: { width: 0.03, height: h * 0.55, depth: 0.02 }, color: COLORS.tube },
  ];
  return { id: 'neonSign', parts };
}

export function neonSignParts(): PropPartSpec[] {
  return lowerPropRecipe(neonSignRecipe());
}
