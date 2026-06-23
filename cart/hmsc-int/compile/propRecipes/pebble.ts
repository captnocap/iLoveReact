import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const pebbleDef: PropKindDefinition = {
  kind: 'pebble',
  label: 'Pebble',
  solid: false,
  footprintRadiusMeters: 0.08,
  heightMeters: 0.06,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  main: recipeColor('#8a8a8a'),
} satisfies Record<string, Color>;

export function pebbleRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'sphere',
      position: { x: 0, y: 0.030, z: 0 },
      size: { width: 0.160, height: 0.060, depth: 0.160 },
      color: COLORS.main,
    },
  ];
  return { id: 'pebble', parts };
}

export function pebbleParts(): PropPartSpec[] {
  return lowerPropRecipe(pebbleRecipe());
}
