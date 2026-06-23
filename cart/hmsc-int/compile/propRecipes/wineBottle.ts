import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const wineBottleDef: PropKindDefinition = {
  kind: 'wineBottle',
  label: 'Wine Bottle',
  solid: true,
  footprintRadiusMeters: 0.04,
  heightMeters: 0.3,
  tileKind: 'wall',
  trafficControl: 'none',
  dynamics: { bodyRadiusMeters: 0.04, restitution: 0.18 },
};

const COLORS = {
  glass: recipeColor('#2d4a33'),
  glassLight: recipeColor('#3d5a43'),
  foil: recipeColor('#8a4a32'),
} satisfies Record<string, Color>;

export function wineBottleRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'cylinder16',
      position: { x: 0, y: 0.12, z: 0 },
      radius: 0.038,
      height: 0.22,
      color: COLORS.glass,
    },
    {
      id: 'bodyHighlight',
      shape: 'cylinder16',
      position: { x: 0.02, y: 0.12, z: 0.02 },
      radius: 0.01,
      height: 0.18,
      color: COLORS.glassLight,
    },
    {
      id: 'shoulder',
      shape: 'cylinder16',
      position: { x: 0, y: 0.23, z: 0 },
      radius: 0.022,
      height: 0.05,
      color: COLORS.glass,
    },
    {
      id: 'neck',
      shape: 'cylinder16',
      position: { x: 0, y: 0.27, z: 0 },
      radius: 0.015,
      height: 0.06,
      color: COLORS.glass,
    },
    {
      id: 'foil',
      shape: 'cylinder16',
      position: { x: 0, y: 0.285, z: 0 },
      radius: 0.016,
      height: 0.04,
      color: COLORS.foil,
    },
  ];
  return { id: 'wineBottle', parts };
}

export function wineBottleParts(): PropPartSpec[] {
  return lowerPropRecipe(wineBottleRecipe());
}
