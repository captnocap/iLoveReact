import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const coffeeTableDef: PropKindDefinition = {
  kind: 'coffeeTable',
  label: 'Coffee Table',
  solid: true,
  footprintRadiusMeters: 0.65,
  heightMeters: 0.45,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'soft',
};

const COLORS = {
  top: recipeColor('#8a6240'),
  leg: recipeColor('#6b4a2e'),
} satisfies Record<string, Color>;

export function coffeeTableRecipe(): PropRecipe {
  const w = 1.3;
  const d = 0.75;
  const h = 0.45;
  const parts: PropRecipePart[] = [
    { id: 'top', shape: 'box', position: { x: 0, y: h, z: 0 }, size: { width: w, height: 0.05, depth: d }, color: COLORS.top },
    { id: 'legFL', shape: 'box', position: { x: w * 0.4, y: h / 2, z: d * 0.35 }, size: { width: 0.06, height: h, depth: 0.06 }, color: COLORS.leg },
    { id: 'legFR', shape: 'box', position: { x: -w * 0.4, y: h / 2, z: d * 0.35 }, size: { width: 0.06, height: h, depth: 0.06 }, color: COLORS.leg },
    { id: 'legBL', shape: 'box', position: { x: w * 0.4, y: h / 2, z: -d * 0.35 }, size: { width: 0.06, height: h, depth: 0.06 }, color: COLORS.leg },
    { id: 'legBR', shape: 'box', position: { x: -w * 0.4, y: h / 2, z: -d * 0.35 }, size: { width: 0.06, height: h, depth: 0.06 }, color: COLORS.leg },
    { id: 'shelf', shape: 'box', position: { x: 0, y: h * 0.25, z: 0 }, size: { width: w * 0.75, height: 0.03, depth: d * 0.55 }, color: COLORS.leg },
  ];
  return { id: 'coffeeTable', parts };
}

export function coffeeTableParts(): PropPartSpec[] {
  return lowerPropRecipe(coffeeTableRecipe());
}
