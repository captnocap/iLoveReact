import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const barrierPlasticDef: PropKindDefinition = {
  kind: 'barrierPlastic',
  label: 'Plastic Barrier',
  solid: true,
  footprintRadiusMeters: 0.55,
  heightMeters: 0.75,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  main: recipeColor('#e8b84a'),
} satisfies Record<string, Color>;

export function barrierPlasticRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'box',
      position: { x: 0, y: 0.375, z: 0 },
      size: { width: 0.990, height: 0.750, depth: 0.880 },
      color: COLORS.main,
    },
  ];
  return { id: 'barrierPlastic', parts };
}

export function barrierPlasticParts(): PropPartSpec[] {
  return lowerPropRecipe(barrierPlasticRecipe());
}
