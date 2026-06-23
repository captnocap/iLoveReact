import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const rouletteTableDef: PropKindDefinition = {
  kind: 'rouletteTable',
  label: 'Roulette Table',
  solid: true,
  footprintRadiusMeters: 0.9,
  heightMeters: 0.82,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  top: recipeColor('#2d5a33'),
  leg: recipeColor('#1d3a21'),
} satisfies Record<string, Color>;

export function rouletteTableRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'top', shape: 'box', position: { x: 0, y: 0.800, z: 0 }, size: { width: 1.620, height: 0.04, depth: 1.080 }, color: COLORS.top },
    { id: 'legFL', shape: 'box', position: { x: -0.780, y: 0.410, z: 0.510 }, size: { width: 0.04, height: 0.820, depth: 0.04 }, color: COLORS.leg },
    { id: 'legFR', shape: 'box', position: { x: 0.780, y: 0.410, z: 0.510 }, size: { width: 0.04, height: 0.820, depth: 0.04 }, color: COLORS.leg },
    { id: 'legBL', shape: 'box', position: { x: -0.780, y: 0.410, z: -0.510 }, size: { width: 0.04, height: 0.820, depth: 0.04 }, color: COLORS.leg },
    { id: 'legBR', shape: 'box', position: { x: 0.780, y: 0.410, z: -0.510 }, size: { width: 0.04, height: 0.820, depth: 0.04 }, color: COLORS.leg },
  ];
  return { id: 'rouletteTable', parts };
}

export function rouletteTableParts(): PropPartSpec[] {
  return lowerPropRecipe(rouletteTableRecipe());
}
