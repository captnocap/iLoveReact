import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const bushBambooDef: PropKindDefinition = {
  kind: 'bushBamboo',
  label: 'Bamboo Bush',
  solid: false,
  footprintRadiusMeters: 0.4,
  heightMeters: 1.2,
  tileKind: 'bush',
  trafficControl: 'none',
};

const COLORS = {
  leaf: recipeColor('#6b8a3a'),
  leafDark: recipeColor('#50672b'),
} satisfies Record<string, Color>;

export function bushBambooRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'clumpA', shape: 'sphere', position: { x: 0, y: 0.540, z: 0 }, size: { width: 0.560, height: 1.200, depth: 0.560 }, color: COLORS.leaf },
    { id: 'clumpB', shape: 'sphere', position: { x: 0.140, y: 0.420, z: 0.080 }, size: { width: 0.400, height: 0.840, depth: 0.400 }, color: COLORS.leafDark },
    { id: 'clumpC', shape: 'sphere', position: { x: -0.120, y: 0.360, z: -0.100 }, size: { width: 0.360, height: 0.780, depth: 0.360 }, color: COLORS.leafDark },
  ];
  return { id: 'bushBamboo', parts };
}

export function bushBambooParts(): PropPartSpec[] {
  return lowerPropRecipe(bushBambooRecipe());
}
