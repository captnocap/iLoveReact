import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const coolerProduceDef: PropKindDefinition = {
  kind: 'coolerProduce',
  label: 'Produce Cooler',
  solid: true,
  footprintRadiusMeters: 0.6,
  heightMeters: 0.7,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'food', capacity: 4, spawnFillChance: 0.7, searchSeconds: 2, access: 'open' },
};

const COLORS = {
  main: recipeColor('#4a7d3a'),
} satisfies Record<string, Color>;

export function coolerProduceRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'box',
      position: { x: 0, y: 0.350, z: 0 },
      size: { width: 1.080, height: 0.700, depth: 0.960 },
      color: COLORS.main,
    },
  ];
  return { id: 'coolerProduce', parts };
}

export function coolerProduceParts(): PropPartSpec[] {
  return lowerPropRecipe(coolerProduceRecipe());
}
