import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const sculptureDef: PropKindDefinition = {
  kind: 'sculpture',
  label: 'Sculpture',
  solid: true,
  footprintRadiusMeters: 0.35,
  heightMeters: 1.0,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  main: recipeColor('#9aa1ab'),
} satisfies Record<string, Color>;

export function sculptureRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'sphere',
      position: { x: 0, y: 0.500, z: 0 },
      size: { width: 0.700, height: 1.000, depth: 0.700 },
      color: COLORS.main,
    },
  ];
  return { id: 'sculpture', parts };
}

export function sculptureParts(): PropPartSpec[] {
  return lowerPropRecipe(sculptureRecipe());
}
