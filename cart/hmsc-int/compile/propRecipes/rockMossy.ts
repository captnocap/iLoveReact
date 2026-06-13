import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const rockMossyDef: PropKindDefinition = {
  kind: 'rockMossy',
  label: 'Mossy Rock',
  solid: true,
  footprintRadiusMeters: 0.6,
  heightMeters: 0.85,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  stone: recipeColor('#6b7079'),
  stoneDark: recipeColor('#52565d'),
  stoneLight: recipeColor('#82868d'),
  moss: recipeColor('#3f6b33'),
  mossLight: recipeColor('#558a42'),
} satisfies Record<string, Color>;

export function rockMossyRecipe(heightMeters: number, footprintRadiusMeters: number): PropRecipe {
  const h = heightMeters;
  const r = footprintRadiusMeters;
  const blobs: [string, number, number, number, number, number, Color][] = [
    ['mainMass', 0, h * 0.42, 0, r * 0.95, 0.78, COLORS.stone],
    ['rightStoneFacet', r * 0.5, h * 0.3, -r * 0.35, r * 0.62, 0.72, COLORS.stoneDark],
    ['leftStoneFacet', -r * 0.48, h * 0.26, r * 0.4, r * 0.58, 0.7, COLORS.stoneLight],
    ['topMossPatch', 0, h * 0.62, 0, r * 0.72, 0.4, COLORS.moss],
    ['rightMossPatch', r * 0.42, h * 0.5, -r * 0.28, r * 0.42, 0.36, COLORS.mossLight],
    ['leftMossPatch', -r * 0.35, h * 0.46, r * 0.3, r * 0.38, 0.34, COLORS.moss],
  ];
  const parts: PropRecipePart[] = blobs.map(([id, x, y, z, radius, squash, color]) => ({
    id,
    shape: 'sphere',
    position: { x, y, z },
    size: { width: radius * 2, height: radius * 2 * squash, depth: radius * 2 },
    color,
  }));
  return { id: 'rockMossy', parts };
}

export function rockMossyParts(heightMeters: number, footprintRadiusMeters: number): PropPartSpec[] {
  return lowerPropRecipe(rockMossyRecipe(heightMeters, footprintRadiusMeters));
}
