import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const towelDef: PropKindDefinition = {
  kind: 'towel',
  label: 'Towel',
  solid: false,
  footprintRadiusMeters: 0.12,
  footprintDepthMeters: 0.1,
  heightMeters: 0.7,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'none',
};

const COLORS = {
  fabric: recipeColor('#eef0f2'),
  stripe: recipeColor('#3a7d80'),
} satisfies Record<string, Color>;

export function towelRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'bar', shape: 'box', position: { x: 0, y: 0.62, z: -0.02 }, size: { width: 0.3, height: 0.03, depth: 0.03 }, color: COLORS.stripe },
    { id: 'body', shape: 'box', position: { x: 0, y: 0.32, z: 0.03 }, size: { width: 0.24, height: 0.6, depth: 0.04 }, color: COLORS.fabric },
    { id: 'fold', shape: 'box', position: { x: 0, y: 0.45, z: 0.035 }, size: { width: 0.24, height: 0.04, depth: 0.05 }, color: COLORS.stripe },
  ];
  return { id: 'towel', parts };
}

export function towelParts(): PropPartSpec[] {
  return lowerPropRecipe(towelRecipe());
}
