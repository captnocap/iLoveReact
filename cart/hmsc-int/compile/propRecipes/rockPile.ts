import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const rockPileDef: PropKindDefinition = {
  kind: 'rockPile',
  label: 'Rock Pile',
  solid: true,
  footprintRadiusMeters: 0.8,
  heightMeters: 0.7,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  stone: recipeColor('#6b7079'),
  stoneDark: recipeColor('#52565d'),
  stoneLight: recipeColor('#82868d'),
} satisfies Record<string, Color>;

export function rockPileRecipe(heightMeters: number, footprintRadiusMeters: number): PropRecipe {
  const h = heightMeters;
  const r = footprintRadiusMeters;
  const blobs: [string, number, number, number, number, number, Color][] = [
    ['centerRock', 0, h * 0.5, 0, r * 0.5, 0.85, COLORS.stone],
    ['rightFrontRock', r * 0.55, h * 0.3, r * 0.2, r * 0.38, 0.8, COLORS.stoneDark],
    ['leftBackRock', -r * 0.5, h * 0.32, -r * 0.25, r * 0.4, 0.78, COLORS.stoneLight],
    ['rightBackRock', r * 0.2, h * 0.28, -r * 0.55, r * 0.34, 0.75, COLORS.stone],
    ['leftFrontRock', -r * 0.25, h * 0.26, r * 0.55, r * 0.32, 0.72, COLORS.stoneDark],
    ['farRightRock', r * 0.6, h * 0.22, -r * 0.35, r * 0.26, 0.7, COLORS.stoneLight],
    ['farLeftRock', -r * 0.65, h * 0.2, r * 0.1, r * 0.24, 0.68, COLORS.stone],
  ];
  const parts: PropRecipePart[] = blobs.map(([id, x, y, z, radius, squash, color]) => ({
    id,
    shape: 'sphere',
    position: { x, y, z },
    size: { width: radius * 2, height: radius * 2 * squash, depth: radius * 2 },
    color,
  }));
  return { id: 'rockPile', parts };
}

export function rockPileParts(heightMeters: number, footprintRadiusMeters: number): PropPartSpec[] {
  return lowerPropRecipe(rockPileRecipe(heightMeters, footprintRadiusMeters));
}
