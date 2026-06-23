import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const bushBoxwoodDef: PropKindDefinition = {
  kind: 'bushBoxwood',
  label: 'Boxwood Bush',
  solid: false,
  footprintRadiusMeters: 0.45,
  heightMeters: 0.6,
  tileKind: 'bush',
  trafficControl: 'none',
};

const COLORS = {
  leaf: recipeColor('#4a6b3a'),
  leafDark: recipeColor('#37502b'),
} satisfies Record<string, Color>;

export function bushBoxwoodRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'clumpA', shape: 'sphere', position: { x: 0, y: 0.270, z: 0 }, size: { width: 0.630, height: 0.600, depth: 0.630 }, color: COLORS.leaf },
    { id: 'clumpB', shape: 'sphere', position: { x: 0.158, y: 0.210, z: 0.090 }, size: { width: 0.450, height: 0.420, depth: 0.450 }, color: COLORS.leafDark },
    { id: 'clumpC', shape: 'sphere', position: { x: -0.135, y: 0.180, z: -0.113 }, size: { width: 0.405, height: 0.390, depth: 0.405 }, color: COLORS.leafDark },
  ];
  return { id: 'bushBoxwood', parts };
}

export function bushBoxwoodParts(): PropPartSpec[] {
  return lowerPropRecipe(bushBoxwoodRecipe());
}
