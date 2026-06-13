import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const rockFlatDef: PropKindDefinition = {
  kind: 'rockFlat',
  label: 'Flat Rock',
  solid: true,
  footprintRadiusMeters: 0.9,
  heightMeters: 0.45,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  stone: recipeColor('#6b7079'),
  stoneDark: recipeColor('#52565d'),
  stoneLight: recipeColor('#82868d'),
} satisfies Record<string, Color>;

export function rockFlatRecipe(heightMeters: number, footprintRadiusMeters: number): PropRecipe {
  const h = heightMeters;
  const r = footprintRadiusMeters;
  const blobs: [string, number, number, number, number, number, Color][] = [
    ['mainSlab', 0, h * 0.5, 0, r * 0.98, 0.5, COLORS.stone],
    ['rightSlabFacet', r * 0.35, h * 0.55, r * 0.25, r * 0.6, 0.5, COLORS.stoneLight],
    ['leftSlabFacet', -r * 0.4, h * 0.45, -r * 0.2, r * 0.62, 0.48, COLORS.stoneDark],
  ];
  const parts: PropRecipePart[] = blobs.map(([id, x, y, z, radius, squash, color]) => ({
    id,
    shape: 'sphere',
    position: { x, y, z },
    size: { width: radius * 2, height: radius * 2 * squash, depth: radius * 2 },
    color,
  }));
  return { id: 'rockFlat', parts };
}

export function rockFlatParts(heightMeters: number, footprintRadiusMeters: number): PropPartSpec[] {
  return lowerPropRecipe(rockFlatRecipe(heightMeters, footprintRadiusMeters));
}
