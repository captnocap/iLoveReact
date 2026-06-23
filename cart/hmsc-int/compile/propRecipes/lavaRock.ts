import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const lavaRockDef: PropKindDefinition = {
  kind: 'lavaRock',
  label: 'Lava Rock',
  solid: true,
  footprintRadiusMeters: 0.3,
  heightMeters: 0.25,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  main: recipeColor('#3a3f46'),
} satisfies Record<string, Color>;

export function lavaRockRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'box',
      position: { x: 0, y: 0.125, z: 0 },
      size: { width: 0.540, height: 0.250, depth: 0.480 },
      color: COLORS.main,
    },
  ];
  return { id: 'lavaRock', parts };
}

export function lavaRockParts(): PropPartSpec[] {
  return lowerPropRecipe(lavaRockRecipe());
}
