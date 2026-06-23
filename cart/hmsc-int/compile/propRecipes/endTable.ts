import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const endTableDef: PropKindDefinition = {
  kind: 'endTable',
  label: 'End Table',
  solid: true,
  footprintRadiusMeters: 0.38,
  heightMeters: 0.6,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'soft',
};

const COLORS = {
  top: recipeColor('#8a6240'),
  leg: recipeColor('#6b4a2e'),
} satisfies Record<string, Color>;

export function endTableRecipe(): PropRecipe {
  const w = 0.76;
  const h = 0.6;
  const parts: PropRecipePart[] = [
    { id: 'top', shape: 'box', position: { x: 0, y: h, z: 0 }, size: { width: w, height: 0.05, depth: w }, color: COLORS.top },
    { id: 'legFL', shape: 'box', position: { x: w * 0.35, y: h / 2, z: w * 0.35 }, size: { width: 0.05, height: h, depth: 0.05 }, color: COLORS.leg },
    { id: 'legFR', shape: 'box', position: { x: -w * 0.35, y: h / 2, z: w * 0.35 }, size: { width: 0.05, height: h, depth: 0.05 }, color: COLORS.leg },
    { id: 'legBL', shape: 'box', position: { x: w * 0.35, y: h / 2, z: -w * 0.35 }, size: { width: 0.05, height: h, depth: 0.05 }, color: COLORS.leg },
    { id: 'legBR', shape: 'box', position: { x: -w * 0.35, y: h / 2, z: -w * 0.35 }, size: { width: 0.05, height: h, depth: 0.05 }, color: COLORS.leg },
    { id: 'drawer', shape: 'box', position: { x: 0, y: h * 0.55, z: 0 }, size: { width: w * 0.65, height: 0.12, depth: w * 0.55 }, color: COLORS.leg },
  ];
  return { id: 'endTable', parts };
}

export function endTableParts(): PropPartSpec[] {
  return lowerPropRecipe(endTableRecipe());
}
