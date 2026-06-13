import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const boulderDef: PropKindDefinition = {
  kind: 'boulder',
  label: 'Boulder',
  solid: true,
  footprintRadiusMeters: 1.6,
  heightMeters: 2.6,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  stone: recipeColor('#6b7079'),
  stoneDark: recipeColor('#52565d'),
  stoneLight: recipeColor('#82868d'),
} satisfies Record<string, Color>;

export function boulderRecipe(heightMeters: number, footprintRadiusMeters: number): PropRecipe {
  const h = heightMeters;
  const r = footprintRadiusMeters;
  const blobs: [string, number, number, number, number, number, Color][] = [
    ['mainMass', 0, h * 0.45, 0, r * 0.92, 0.92, COLORS.stone],
    ['rightFacet', r * 0.45, h * 0.3, -r * 0.3, r * 0.6, 0.8, COLORS.stoneDark],
    ['leftFacet', -r * 0.5, h * 0.28, r * 0.35, r * 0.55, 0.75, COLORS.stoneLight],
    ['topBackFacet', -r * 0.12, h * 0.68, -r * 0.2, r * 0.5, 0.8, COLORS.stoneDark],
    ['topFrontFacet', r * 0.2, h * 0.6, r * 0.4, r * 0.42, 0.72, COLORS.stoneLight],
  ];
  const parts: PropRecipePart[] = blobs.map(([id, x, y, z, radius, squash, color]) => ({
    id,
    shape: 'sphere',
    position: { x, y, z },
    size: { width: radius * 2, height: radius * 2 * squash, depth: radius * 2 },
    color,
  }));
  return { id: 'boulder', parts };
}

export function boulderParts(heightMeters: number, footprintRadiusMeters: number): PropPartSpec[] {
  return lowerPropRecipe(boulderRecipe(heightMeters, footprintRadiusMeters));
}
