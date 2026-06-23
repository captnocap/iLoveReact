import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const crapsTableDef: PropKindDefinition = {
  kind: 'crapsTable',
  label: 'Craps Table',
  solid: true,
  footprintRadiusMeters: 1.1,
  heightMeters: 0.82,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  top: recipeColor('#2d5a33'),
  leg: recipeColor('#1d3a21'),
} satisfies Record<string, Color>;

export function crapsTableRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'top', shape: 'box', position: { x: 0, y: 0.800, z: 0 }, size: { width: 1.980, height: 0.04, depth: 1.320 }, color: COLORS.top },
    { id: 'legFL', shape: 'box', position: { x: -0.960, y: 0.410, z: 0.630 }, size: { width: 0.04, height: 0.820, depth: 0.04 }, color: COLORS.leg },
    { id: 'legFR', shape: 'box', position: { x: 0.960, y: 0.410, z: 0.630 }, size: { width: 0.04, height: 0.820, depth: 0.04 }, color: COLORS.leg },
    { id: 'legBL', shape: 'box', position: { x: -0.960, y: 0.410, z: -0.630 }, size: { width: 0.04, height: 0.820, depth: 0.04 }, color: COLORS.leg },
    { id: 'legBR', shape: 'box', position: { x: 0.960, y: 0.410, z: -0.630 }, size: { width: 0.04, height: 0.820, depth: 0.04 }, color: COLORS.leg },
  ];
  return { id: 'crapsTable', parts };
}

export function crapsTableParts(): PropPartSpec[] {
  return lowerPropRecipe(crapsTableRecipe());
}
