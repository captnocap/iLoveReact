import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const officeDeskDef: PropKindDefinition = {
  kind: 'officeDesk',
  label: 'Office Desk',
  solid: true,
  footprintRadiusMeters: 0.85,
  footprintDepthMeters: 0.8,
  heightMeters: 0.78,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'soft',
};

const COLORS = {
  top: recipeColor('#c2a878'),
  leg: recipeColor('#6b4a2e'),
  modesty: recipeColor('#8a6240'),
} satisfies Record<string, Color>;

export function officeDeskRecipe(): PropRecipe {
  const w = 1.7;
  const d = 0.8;
  const h = 0.78;
  const parts: PropRecipePart[] = [
    { id: 'top', shape: 'box', position: { x: 0, y: h, z: 0 }, size: { width: w, height: 0.04, depth: d }, color: COLORS.top },
    { id: 'leftLeg', shape: 'box', position: { x: -w * 0.38, y: h / 2, z: 0 }, size: { width: 0.06, height: h, depth: d * 0.75 }, color: COLORS.leg },
    { id: 'rightLeg', shape: 'box', position: { x: w * 0.38, y: h / 2, z: 0 }, size: { width: 0.06, height: h, depth: d * 0.75 }, color: COLORS.leg },
    { id: 'modestyPanel', shape: 'box', position: { x: 0, y: h * 0.45, z: -d * 0.25 }, size: { width: w * 0.6, height: h * 0.55, depth: 0.03 }, color: COLORS.modesty },
    { id: 'drawerBank', shape: 'box', position: { x: w * 0.3, y: h - 0.18, z: d * 0.22 }, size: { width: w * 0.32, height: 0.28, depth: 0.42 }, color: COLORS.modesty },
  ];
  return { id: 'officeDesk', parts };
}

export function officeDeskParts(): PropPartSpec[] {
  return lowerPropRecipe(officeDeskRecipe());
}
