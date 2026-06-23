import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const pokerTableDef: PropKindDefinition = {
  kind: 'pokerTable',
  label: 'Poker Table',
  solid: true,
  footprintRadiusMeters: 0.9,
  heightMeters: 0.78,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'soft',
};

const COLORS = {
  rail: recipeColor('#3a3f46'),
  felt: recipeColor('#2d6a4f'),
  leg: recipeColor('#6b4a2e'),
} satisfies Record<string, Color>;

export function pokerTableRecipe(): PropRecipe {
  const r = 0.9;
  const h = 0.78;
  const parts: PropRecipePart[] = [
    { id: 'felt', shape: 'cylinder16', position: { x: 0, y: h, z: 0 }, radius: r * 0.85, height: 0.04, color: COLORS.felt },
    { id: 'rail', shape: 'cylinder16', position: { x: 0, y: h + 0.03, z: 0 }, radius: r, height: 0.06, color: COLORS.rail },
    { id: 'pedestal', shape: 'box', position: { x: 0, y: h * 0.45, z: 0 }, size: { width: 0.35, height: h * 0.75, depth: 0.35 }, color: COLORS.leg },
    { id: 'base', shape: 'box', position: { x: 0, y: 0.04, z: 0 }, size: { width: 0.8, height: 0.06, depth: 0.8 }, color: COLORS.leg },
  ];
  return { id: 'pokerTable', parts };
}

export function pokerTableParts(): PropPartSpec[] {
  return lowerPropRecipe(pokerTableRecipe());
}
