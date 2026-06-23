import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const urinalDef: PropKindDefinition = {
  kind: 'urinal',
  label: 'Urinal',
  solid: true,
  footprintRadiusMeters: 0.2,
  heightMeters: 0.65,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
};

const COLORS = {
  ceramic: recipeColor('#eef0f2'),
  pipe: recipeColor('#a6a8a9'),
} satisfies Record<string, Color>;

export function urinalRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'bowl', shape: 'box', position: { x: 0, y: 0.227, z: 0.040 }, size: { width: 0.240, height: 0.358, depth: 0.160 }, color: COLORS.ceramic },
    { id: 'back', shape: 'box', position: { x: 0, y: 0.358, z: -0.030 }, size: { width: 0.200, height: 0.227, depth: 0.050 }, color: COLORS.ceramic },
    { id: 'pipe', shape: 'cylinder8', position: { x: 0, y: 0.552, z: -0.030 }, radius: 0.024, height: 0.163, color: COLORS.pipe },
  ];
  return { id: 'urinal', parts };
}

export function urinalParts(): PropPartSpec[] {
  return lowerPropRecipe(urinalRecipe());
}
