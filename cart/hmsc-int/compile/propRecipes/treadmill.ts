import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const treadmillDef: PropKindDefinition = {
  kind: 'treadmill',
  label: 'Treadmill',
  solid: true,
  footprintRadiusMeters: 0.4,
  heightMeters: 0.7,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  main: recipeColor('#1a1c1e'),
} satisfies Record<string, Color>;

export function treadmillRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'box',
      position: { x: 0, y: 0.350, z: 0 },
      size: { width: 0.720, height: 0.700, depth: 0.640 },
      color: COLORS.main,
    },
  ];
  return { id: 'treadmill', parts };
}

export function treadmillParts(): PropPartSpec[] {
  return lowerPropRecipe(treadmillRecipe());
}
