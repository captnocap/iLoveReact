import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const diningTableDef: PropKindDefinition = {
  kind: 'diningTable',
  label: 'Dining Table',
  solid: true,
  footprintRadiusMeters: 1.1,
  heightMeters: 0.78,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'soft',
};

const COLORS = {
  top: recipeColor('#c2a878'),
  leg: recipeColor('#6b4a2e'),
} satisfies Record<string, Color>;

export function diningTableRecipe(): PropRecipe {
  const w = 2.2;
  const d = 1.1;
  const h = 0.78;
  const parts: PropRecipePart[] = [
    { id: 'top', shape: 'box', position: { x: 0, y: h, z: 0 }, size: { width: w, height: 0.06, depth: d }, color: COLORS.top },
    { id: 'legL', shape: 'box', position: { x: -w * 0.38, y: h / 2, z: 0 }, size: { width: 0.1, height: h, depth: d * 0.65 }, color: COLORS.leg },
    { id: 'legR', shape: 'box', position: { x: w * 0.38, y: h / 2, z: 0 }, size: { width: 0.1, height: h, depth: d * 0.65 }, color: COLORS.leg },
    { id: 'cross', shape: 'box', position: { x: 0, y: h * 0.35, z: 0 }, size: { width: w * 0.6, height: 0.04, depth: 0.04 }, color: COLORS.leg },
  ];
  return { id: 'diningTable', parts };
}

export function diningTableParts(): PropPartSpec[] {
  return lowerPropRecipe(diningTableRecipe());
}
