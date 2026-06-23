import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const soupCanDef: PropKindDefinition = {
  kind: 'soupCan',
  label: 'Soup Can',
  solid: true,
  footprintRadiusMeters: 0.05,
  heightMeters: 0.12,
  tileKind: 'wall',
  trafficControl: 'none',
  dynamics: { bodyRadiusMeters: 0.05, restitution: 0.15 },
};

const COLORS = {
  label: recipeColor('#e8b84a'),
  lid: recipeColor('#9aa1ab'),
  rim: recipeColor('#b0b6bc'),
} satisfies Record<string, Color>;

export function soupCanRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'cylinder16',
      position: { x: 0, y: 0.05, z: 0 },
      radius: 0.045,
      height: 0.1,
      color: COLORS.label,
    },
    {
      id: 'topRim',
      shape: 'cylinder16',
      position: { x: 0, y: 0.105, z: 0 },
      radius: 0.046,
      height: 0.01,
      color: COLORS.rim,
    },
    {
      id: 'bottomRim',
      shape: 'cylinder16',
      position: { x: 0, y: 0.005, z: 0 },
      radius: 0.046,
      height: 0.01,
      color: COLORS.rim,
    },
    {
      id: 'topLid',
      shape: 'cylinder16',
      position: { x: 0, y: 0.11, z: 0 },
      radius: 0.04,
      height: 0.01,
      color: COLORS.lid,
    },
  ];
  return { id: 'soupCan', parts };
}

export function soupCanParts(): PropPartSpec[] {
  return lowerPropRecipe(soupCanRecipe());
}
