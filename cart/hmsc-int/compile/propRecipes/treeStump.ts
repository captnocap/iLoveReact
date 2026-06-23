import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const treeStumpDef: PropKindDefinition = {
  kind: 'treeStump',
  label: 'Tree Stump',
  solid: true,
  footprintRadiusMeters: 0.35,
  heightMeters: 0.5,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'low',
};

const COLORS = {
  main: recipeColor('#6b4a2e'),
} satisfies Record<string, Color>;

export function treeStumpRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'cylinder16',
      position: { x: 0, y: 0.250, z: 0 },
      radius: 0.350,
      height: 0.500,
      color: COLORS.main,
    },
  ];
  return { id: 'treeStump', parts };
}

export function treeStumpParts(): PropPartSpec[] {
  return lowerPropRecipe(treeStumpRecipe());
}
