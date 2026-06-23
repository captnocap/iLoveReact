import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const dumpsterTrashDef: PropKindDefinition = {
  kind: 'dumpsterTrash',
  label: 'Trash Dumpster',
  solid: true,
  footprintRadiusMeters: 0.9,
  heightMeters: 1.57,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'junk', capacity: 6, spawnFillChance: 0.7, searchSeconds: 4, access: 'open' },
};

const COLORS = {
  main: recipeColor('#3a4a30'),
} satisfies Record<string, Color>;

export function dumpsterTrashRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'box',
      position: { x: 0, y: 0.785, z: 0 },
      size: { width: 1.620, height: 1.570, depth: 1.440 },
      color: COLORS.main,
    },
  ];
  return { id: 'dumpsterTrash', parts };
}

export function dumpsterTrashParts(): PropPartSpec[] {
  return lowerPropRecipe(dumpsterTrashRecipe());
}
