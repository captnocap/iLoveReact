import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const dumpsterRecyclingDef: PropKindDefinition = {
  kind: 'dumpsterRecycling',
  label: 'Recycling Dumpster',
  solid: true,
  footprintRadiusMeters: 0.9,
  heightMeters: 1.57,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'junk', capacity: 6, spawnFillChance: 0.6, searchSeconds: 4, access: 'open' },
};

const COLORS = {
  main: recipeColor('#2d5a7d'),
} satisfies Record<string, Color>;

export function dumpsterRecyclingRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'box',
      position: { x: 0, y: 0.785, z: 0 },
      size: { width: 1.620, height: 1.570, depth: 1.440 },
      color: COLORS.main,
    },
  ];
  return { id: 'dumpsterRecycling', parts };
}

export function dumpsterRecyclingParts(): PropPartSpec[] {
  return lowerPropRecipe(dumpsterRecyclingRecipe());
}
