import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const treeLogDef: PropKindDefinition = {
  kind: 'treeLog',
  label: 'Tree Log',
  solid: true,
  footprintRadiusMeters: 0.3,
  heightMeters: 1.5,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'low',
};

const COLORS = {
  main: recipeColor('#6b4a2e'),
} satisfies Record<string, Color>;

export function treeLogRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'cylinder16',
      position: { x: 0, y: 0.750, z: 0 },
      radius: 0.300,
      height: 1.500,
      color: COLORS.main,
    },
  ];
  return { id: 'treeLog', parts };
}

export function treeLogParts(): PropPartSpec[] {
  return lowerPropRecipe(treeLogRecipe());
}
