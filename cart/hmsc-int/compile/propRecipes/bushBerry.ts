import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const bushBerryDef: PropKindDefinition = {
  kind: 'bushBerry',
  label: 'Berry Bush',
  solid: false,
  footprintRadiusMeters: 0.4,
  heightMeters: 0.6,
  tileKind: 'bush',
  trafficControl: 'none',
};

const COLORS = {
  leaf: recipeColor('#3a5a2a'),
  leafDark: recipeColor('#2b431f'),
} satisfies Record<string, Color>;

export function bushBerryRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'clumpA', shape: 'sphere', position: { x: 0, y: 0.270, z: 0 }, size: { width: 0.560, height: 0.600, depth: 0.560 }, color: COLORS.leaf },
    { id: 'clumpB', shape: 'sphere', position: { x: 0.140, y: 0.210, z: 0.080 }, size: { width: 0.400, height: 0.420, depth: 0.400 }, color: COLORS.leafDark },
    { id: 'clumpC', shape: 'sphere', position: { x: -0.120, y: 0.180, z: -0.100 }, size: { width: 0.360, height: 0.390, depth: 0.360 }, color: COLORS.leafDark },
  ];
  return { id: 'bushBerry', parts };
}

export function bushBerryParts(): PropPartSpec[] {
  return lowerPropRecipe(bushBerryRecipe());
}
