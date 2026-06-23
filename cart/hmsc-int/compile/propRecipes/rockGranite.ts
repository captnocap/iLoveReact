import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const rockGraniteDef: PropKindDefinition = {
  kind: 'rockGranite',
  label: 'Granite Rock',
  solid: true,
  footprintRadiusMeters: 0.4,
  heightMeters: 0.4,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  main: recipeColor('#6c6d70'),
} satisfies Record<string, Color>;

export function rockGraniteRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'box',
      position: { x: 0, y: 0.200, z: 0 },
      size: { width: 0.720, height: 0.400, depth: 0.640 },
      color: COLORS.main,
    },
  ];
  return { id: 'rockGranite', parts };
}

export function rockGraniteParts(): PropPartSpec[] {
  return lowerPropRecipe(rockGraniteRecipe());
}
