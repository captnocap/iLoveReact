import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const hospitalBedDef: PropKindDefinition = {
  kind: 'hospitalBed',
  label: 'Hospital Bed',
  solid: true,
  footprintRadiusMeters: 1.05,
  footprintDepthMeters: 1.0,
  heightMeters: 1.1,
  tileKind: 'wall',
  trafficControl: 'none',
  seat: { pose: 'lay', seatHeightMeters: 0.55, capacity: 1 },
  coverClass: 'soft',
};

const COLORS = {
  frame: recipeColor('#9aa1ab'),
  mattress: recipeColor('#eef0f2'),
  blanket: recipeColor('#3a7d80'),
} satisfies Record<string, Color>;

export function hospitalBedRecipe(): PropRecipe {
  const w = 2.1;
  const d = 1.0;
  const h = 1.1;
  const parts: PropRecipePart[] = [
    { id: 'base', shape: 'box', position: { x: 0, y: 0.25, z: 0 }, size: { width: w * 0.9, height: 0.35, depth: d * 0.9 }, color: COLORS.frame },
    { id: 'mattress', shape: 'box', position: { x: 0, y: 0.58, z: 0 }, size: { width: w * 0.94, height: 0.16, depth: d * 0.9 }, color: COLORS.mattress },
    { id: 'blanket', shape: 'box', position: { x: -w * 0.18, y: 0.68, z: 0 }, size: { width: w * 0.55, height: 0.06, depth: d * 0.92 }, color: COLORS.blanket },
    { id: 'headboard', shape: 'box', position: { x: w * 0.48, y: h * 0.65, z: 0 }, size: { width: 0.06, height: h * 0.7, depth: d }, color: COLORS.frame },
    { id: 'sideRailL', shape: 'box', position: { x: 0, y: 0.72, z: -d * 0.48 }, size: { width: w * 0.7, height: 0.08, depth: 0.03 }, color: COLORS.frame },
    { id: 'sideRailR', shape: 'box', position: { x: 0, y: 0.72, z: d * 0.48 }, size: { width: w * 0.7, height: 0.08, depth: 0.03 }, color: COLORS.frame },
  ];
  return { id: 'hospitalBed', parts };
}

export function hospitalBedParts(): PropPartSpec[] {
  return lowerPropRecipe(hospitalBedRecipe());
}
