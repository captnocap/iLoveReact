import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const bushRoseDef: PropKindDefinition = {
  kind: 'bushRose',
  label: 'Rose Bush',
  solid: false,
  footprintRadiusMeters: 0.35,
  heightMeters: 0.55,
  tileKind: 'bush',
  trafficControl: 'none',
};

const COLORS = {
  leaf: recipeColor('#5c3328'),
  leafDark: recipeColor('#45261e'),
} satisfies Record<string, Color>;

export function bushRoseRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'clumpA', shape: 'sphere', position: { x: 0, y: 0.248, z: 0 }, size: { width: 0.490, height: 0.550, depth: 0.490 }, color: COLORS.leaf },
    { id: 'clumpB', shape: 'sphere', position: { x: 0.122, y: 0.193, z: 0.070 }, size: { width: 0.350, height: 0.385, depth: 0.350 }, color: COLORS.leafDark },
    { id: 'clumpC', shape: 'sphere', position: { x: -0.105, y: 0.165, z: -0.087 }, size: { width: 0.315, height: 0.358, depth: 0.315 }, color: COLORS.leafDark },
  ];
  return { id: 'bushRose', parts };
}

export function bushRoseParts(): PropPartSpec[] {
  return lowerPropRecipe(bushRoseRecipe());
}
