import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const plantHangingDef: PropKindDefinition = {
  kind: 'plantHanging',
  label: 'Hanging Plant',
  solid: false,
  footprintRadiusMeters: 0.18,
  heightMeters: 0.4,
  tileKind: 'bush',
  trafficControl: 'none',
  mount: 'wall',
};

const COLORS = {
  main: recipeColor('#5a7d3a'),
} satisfies Record<string, Color>;

export function plantHangingRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'sphere',
      position: { x: 0, y: 0.200, z: 0 },
      size: { width: 0.360, height: 0.400, depth: 0.360 },
      color: COLORS.main,
    },
  ];
  return { id: 'plantHanging', parts };
}

export function plantHangingParts(): PropPartSpec[] {
  return lowerPropRecipe(plantHangingRecipe());
}
