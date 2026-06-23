import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const dumpsterIndustrialDef: PropKindDefinition = {
  kind: 'dumpsterIndustrial',
  label: 'Industrial Dumpster',
  solid: true,
  footprintRadiusMeters: 1.2,
  heightMeters: 1.9,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'junk', capacity: 8, spawnFillChance: 0.7, searchSeconds: 5, access: 'open' },
};

const COLORS = {
  main: recipeColor('#3a3f46'),
} satisfies Record<string, Color>;

export function dumpsterIndustrialRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'box',
      position: { x: 0, y: 0.950, z: 0 },
      size: { width: 2.160, height: 1.900, depth: 1.920 },
      color: COLORS.main,
    },
  ];
  return { id: 'dumpsterIndustrial', parts };
}

export function dumpsterIndustrialParts(): PropPartSpec[] {
  return lowerPropRecipe(dumpsterIndustrialRecipe());
}
