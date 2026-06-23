import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const standingDeskDef: PropKindDefinition = {
  kind: 'standingDesk',
  label: 'Standing Desk',
  solid: true,
  footprintRadiusMeters: 0.85,
  footprintDepthMeters: 0.75,
  heightMeters: 1.15,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'soft',
};

const COLORS = {
  top: recipeColor('#c2a878'),
  leg: recipeColor('#6b4a2e'),
} satisfies Record<string, Color>;

export function standingDeskRecipe(): PropRecipe {
  const w = 1.7;
  const d = 0.75;
  const h = 1.15;
  const parts: PropRecipePart[] = [
    { id: 'top', shape: 'box', position: { x: 0, y: h, z: 0 }, size: { width: w, height: 0.05, depth: d }, color: COLORS.top },
    { id: 'leftLeg', shape: 'box', position: { x: -w * 0.38, y: h / 2, z: 0 }, size: { width: 0.07, height: h, depth: d * 0.6 }, color: COLORS.leg },
    { id: 'rightLeg', shape: 'box', position: { x: w * 0.38, y: h / 2, z: 0 }, size: { width: 0.07, height: h, depth: d * 0.6 }, color: COLORS.leg },
    { id: 'crossbar', shape: 'box', position: { x: 0, y: h * 0.25, z: 0 }, size: { width: w * 0.6, height: 0.04, depth: 0.04 }, color: COLORS.leg },
  ];
  return { id: 'standingDesk', parts };
}

export function standingDeskParts(): PropPartSpec[] {
  return lowerPropRecipe(standingDeskRecipe());
}
