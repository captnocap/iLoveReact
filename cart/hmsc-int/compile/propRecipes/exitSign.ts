import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const exitSignDef: PropKindDefinition = {
  kind: 'exitSign',
  label: 'Exit Sign',
  solid: true,
  footprintRadiusMeters: 0.35,
  footprintDepthMeters: 0.06,
  heightMeters: 0.25,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'none',
};

const COLORS = {
  housing: recipeColor('#22262b'),
  face: recipeColor('#3a7d80'),
} satisfies Record<string, Color>;

export function exitSignRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'housing', shape: 'box', position: { x: 0, y: 2.1, z: -0.02 }, size: { width: 0.7, height: 0.25, depth: 0.06 }, color: COLORS.housing },
    { id: 'face', shape: 'box', position: { x: 0, y: 2.1, z: -0.055 }, size: { width: 0.62, height: 0.18, depth: 0.01 }, color: COLORS.face },
  ];
  return { id: 'exitSign', parts };
}

export function exitSignParts(): PropPartSpec[] {
  return lowerPropRecipe(exitSignRecipe());
}
