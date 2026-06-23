import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const dumpsterSmallDef: PropKindDefinition = {
  kind: 'dumpsterSmall',
  label: 'Small Dumpster',
  solid: true,
  footprintRadiusMeters: 0.6,
  heightMeters: 1.1,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'junk', capacity: 3, spawnFillChance: 0.6, searchSeconds: 3, access: 'open' },
};

const COLORS = {
  main: recipeColor('#4a5d3f'),
} satisfies Record<string, Color>;

export function dumpsterSmallRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'box',
      position: { x: 0, y: 0.550, z: 0 },
      size: { width: 1.080, height: 1.100, depth: 0.960 },
      color: COLORS.main,
    },
  ];
  return { id: 'dumpsterSmall', parts };
}

export function dumpsterSmallParts(): PropPartSpec[] {
  return lowerPropRecipe(dumpsterSmallRecipe());
}
