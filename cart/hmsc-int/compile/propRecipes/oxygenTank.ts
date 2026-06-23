import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const oxygenTankDef: PropKindDefinition = {
  kind: 'oxygenTank',
  label: 'Oxygen Tank',
  solid: true,
  footprintRadiusMeters: 0.1,
  heightMeters: 0.6,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  body: recipeColor('#2d5a7d'),
  band: recipeColor('#1f3f57'),
  top: recipeColor('#33678f'),
} satisfies Record<string, Color>;

export function oxygenTankRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'body', shape: 'cylinder16', position: { x: 0, y: 0.300, z: 0 }, radius: 0.100, height: 0.510, color: COLORS.body },
    { id: 'band', shape: 'cylinder16', position: { x: 0, y: 0.210, z: 0 }, radius: 0.105, height: 0.048, color: COLORS.band },
    { id: 'top', shape: 'cylinder16', position: { x: 0, y: 0.552, z: 0 }, radius: 0.085, height: 0.048, color: COLORS.top },
  ];
  return { id: 'oxygenTank', parts };
}

export function oxygenTankParts(): PropPartSpec[] {
  return lowerPropRecipe(oxygenTankRecipe());
}
