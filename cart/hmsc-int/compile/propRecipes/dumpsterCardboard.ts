import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const dumpsterCardboardDef: PropKindDefinition = {
  kind: 'dumpsterCardboard',
  label: 'Cardboard Dumpster',
  solid: true,
  footprintRadiusMeters: 0.9,
  heightMeters: 1.57,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'junk', capacity: 6, spawnFillChance: 0.5, searchSeconds: 4, access: 'open' },
};

const COLORS = {
  main: recipeColor('#8a6240'),
} satisfies Record<string, Color>;

export function dumpsterCardboardRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'box',
      position: { x: 0, y: 0.785, z: 0 },
      size: { width: 1.620, height: 1.570, depth: 1.440 },
      color: COLORS.main,
    },
  ];
  return { id: 'dumpsterCardboard', parts };
}

export function dumpsterCardboardParts(): PropPartSpec[] {
  return lowerPropRecipe(dumpsterCardboardRecipe());
}
