import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const sodaCanDef: PropKindDefinition = {
  kind: 'sodaCan',
  label: 'Soda Can',
  solid: true,
  footprintRadiusMeters: 0.04,
  heightMeters: 0.13,
  tileKind: 'wall',
  trafficControl: 'none',
  dynamics: { bodyRadiusMeters: 0.04, restitution: 0.18 },
};

const COLORS = {
  body: recipeColor('#c2362f'),
  top: recipeColor('#aab0b6'),
  tab: recipeColor('#9aa1ab'),
} satisfies Record<string, Color>;

export function sodaCanRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'canBody',
      shape: 'cylinder16',
      position: { x: 0, y: 0.06, z: 0 },
      radius: 0.035,
      height: 0.11,
      color: COLORS.body,
    },
    {
      id: 'canTop',
      shape: 'cylinder16',
      position: { x: 0, y: 0.12, z: 0 },
      radius: 0.032,
      height: 0.01,
      color: COLORS.top,
    },
    {
      id: 'tab',
      shape: 'box',
      position: { x: 0, y: 0.126, z: 0 },
      size: { width: 0.02, height: 0.005, depth: 0.014 },
      color: COLORS.tab,
    },
  ];
  return { id: 'sodaCan', parts };
}

export function sodaCanParts(): PropPartSpec[] {
  return lowerPropRecipe(sodaCanRecipe());
}
