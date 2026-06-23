import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const luggageCartDef: PropKindDefinition = {
  kind: 'luggageCart',
  label: 'Luggage Cart',
  solid: true,
  footprintRadiusMeters: 0.4,
  heightMeters: 0.9,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  main: recipeColor('#9aa1ab'),
} satisfies Record<string, Color>;

export function luggageCartRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'box',
      position: { x: 0, y: 0.450, z: 0 },
      size: { width: 0.720, height: 0.900, depth: 0.640 },
      color: COLORS.main,
    },
  ];
  return { id: 'luggageCart', parts };
}

export function luggageCartParts(): PropPartSpec[] {
  return lowerPropRecipe(luggageCartRecipe());
}
