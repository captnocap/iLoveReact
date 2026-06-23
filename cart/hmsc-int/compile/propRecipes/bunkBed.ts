import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const bunkBedDef: PropKindDefinition = {
  kind: 'bunkBed',
  label: 'Bunk Bed',
  solid: true,
  footprintRadiusMeters: 0.55,
  footprintDepthMeters: 1.0,
  heightMeters: 2.0,
  tileKind: 'wall',
  trafficControl: 'none',
  seat: { pose: 'lay', seatHeightMeters: 0.35, capacity: 2 },
  coverClass: 'soft',
};

const COLORS = {
  frame: recipeColor('#6b4a2e'),
  mattress: recipeColor('#ece8dd'),
  blanket: recipeColor('#3a7d80'),
} satisfies Record<string, Color>;

export function bunkBedRecipe(): PropRecipe {
  const w = 1.1;
  const d = 1.0;
  const h = 2.0;
  const parts: PropRecipePart[] = [
    { id: 'postFL', shape: 'box', position: { x: -w / 2 + 0.04, y: h / 2, z: d / 2 - 0.04 }, size: { width: 0.07, height: h, depth: 0.07 }, color: COLORS.frame },
    { id: 'postFR', shape: 'box', position: { x: w / 2 - 0.04, y: h / 2, z: d / 2 - 0.04 }, size: { width: 0.07, height: h, depth: 0.07 }, color: COLORS.frame },
    { id: 'postBL', shape: 'box', position: { x: -w / 2 + 0.04, y: h / 2, z: -d / 2 + 0.04 }, size: { width: 0.07, height: h, depth: 0.07 }, color: COLORS.frame },
    { id: 'postBR', shape: 'box', position: { x: w / 2 - 0.04, y: h / 2, z: -d / 2 + 0.04 }, size: { width: 0.07, height: h, depth: 0.07 }, color: COLORS.frame },
    { id: 'lowerFrame', shape: 'box', position: { x: 0, y: 0.35, z: 0 }, size: { width: w, height: 0.08, depth: d }, color: COLORS.frame },
    { id: 'lowerMattress', shape: 'box', position: { x: 0, y: 0.45, z: 0 }, size: { width: w * 0.95, height: 0.14, depth: d * 0.94 }, color: COLORS.mattress },
    { id: 'upperFrame', shape: 'box', position: { x: 0, y: 1.25, z: 0 }, size: { width: w, height: 0.08, depth: d }, color: COLORS.frame },
    { id: 'upperMattress', shape: 'box', position: { x: 0, y: 1.35, z: 0 }, size: { width: w * 0.95, height: 0.14, depth: d * 0.94 }, color: COLORS.mattress },
    { id: 'blanket', shape: 'box', position: { x: -w * 0.16, y: 1.42, z: 0 }, size: { width: w * 0.6, height: 0.06, depth: d * 0.96 }, color: COLORS.blanket },
  ];
  return { id: 'bunkBed', parts };
}

export function bunkBedParts(): PropPartSpec[] {
  return lowerPropRecipe(bunkBedRecipe());
}
