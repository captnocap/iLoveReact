import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const barrierJerseyDef: PropKindDefinition = {
  kind: 'barrierJersey',
  label: 'Jersey Barrier',
  solid: true,
  footprintRadiusMeters: 0.6,
  heightMeters: 0.9,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  main: recipeColor('#d4d2c5'),
} satisfies Record<string, Color>;

export function barrierJerseyRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'box',
      position: { x: 0, y: 0.450, z: 0 },
      size: { width: 1.080, height: 0.900, depth: 0.960 },
      color: COLORS.main,
    },
  ];
  return { id: 'barrierJersey', parts };
}

export function barrierJerseyParts(): PropPartSpec[] {
  return lowerPropRecipe(barrierJerseyRecipe());
}
