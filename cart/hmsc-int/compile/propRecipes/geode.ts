import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const geodeDef: PropKindDefinition = {
  kind: 'geode',
  label: 'Geode',
  solid: true,
  footprintRadiusMeters: 0.18,
  heightMeters: 0.22,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  main: recipeColor('#7a5c3a'),
} satisfies Record<string, Color>;

export function geodeRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'sphere',
      position: { x: 0, y: 0.110, z: 0 },
      size: { width: 0.360, height: 0.220, depth: 0.360 },
      color: COLORS.main,
    },
  ];
  return { id: 'geode', parts };
}

export function geodeParts(): PropPartSpec[] {
  return lowerPropRecipe(geodeRecipe());
}
