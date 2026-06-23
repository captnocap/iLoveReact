import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const urinalTroughDef: PropKindDefinition = {
  kind: 'urinalTrough',
  label: 'Urinal Trough',
  solid: true,
  footprintRadiusMeters: 0.6,
  heightMeters: 0.7,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
};

const COLORS = {
  ceramic: recipeColor('#eef0f2'),
  pipe: recipeColor('#a6a8a9'),
} satisfies Record<string, Color>;

export function urinalTroughRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'bowl', shape: 'box', position: { x: 0, y: 0.245, z: 0.120 }, size: { width: 0.720, height: 0.385, depth: 0.480 }, color: COLORS.ceramic },
    { id: 'back', shape: 'box', position: { x: 0, y: 0.385, z: -0.090 }, size: { width: 0.600, height: 0.245, depth: 0.050 }, color: COLORS.ceramic },
    { id: 'pipe', shape: 'cylinder8', position: { x: 0, y: 0.595, z: -0.090 }, radius: 0.072, height: 0.175, color: COLORS.pipe },
  ];
  return { id: 'urinalTrough', parts };
}

export function urinalTroughParts(): PropPartSpec[] {
  return lowerPropRecipe(urinalTroughRecipe());
}
