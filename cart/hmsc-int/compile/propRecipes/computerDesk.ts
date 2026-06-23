import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const computerDeskDef: PropKindDefinition = {
  kind: 'computerDesk',
  label: 'Computer Desk',
  solid: true,
  footprintRadiusMeters: 0.9,
  footprintDepthMeters: 0.75,
  heightMeters: 0.75,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'soft',
};

const COLORS = {
  top: recipeColor('#22262b'),
  frame: recipeColor('#6b4a2e'),
} satisfies Record<string, Color>;

export function computerDeskRecipe(): PropRecipe {
  const w = 1.8;
  const d = 0.75;
  const h = 0.75;
  const parts: PropRecipePart[] = [
    { id: 'top', shape: 'box', position: { x: 0, y: h, z: 0 }, size: { width: w, height: 0.05, depth: d }, color: COLORS.top },
    { id: 'leftLeg', shape: 'box', position: { x: -w * 0.42, y: h / 2, z: 0 }, size: { width: 0.06, height: h, depth: d * 0.8 }, color: COLORS.frame },
    { id: 'rightLeg', shape: 'box', position: { x: w * 0.42, y: h / 2, z: 0 }, size: { width: 0.06, height: h, depth: d * 0.8 }, color: COLORS.frame },
    { id: 'backRail', shape: 'box', position: { x: 0, y: h * 0.75, z: -d * 0.35 }, size: { width: w * 0.7, height: 0.04, depth: 0.04 }, color: COLORS.frame },
  ];
  return { id: 'computerDesk', parts };
}

export function computerDeskParts(): PropPartSpec[] {
  return lowerPropRecipe(computerDeskRecipe());
}
