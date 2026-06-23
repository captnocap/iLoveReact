import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const conferenceTableDef: PropKindDefinition = {
  kind: 'conferenceTable',
  label: 'Conference Table',
  solid: true,
  footprintRadiusMeters: 1.5,
  footprintDepthMeters: 1.2,
  heightMeters: 0.75,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'soft',
};

const COLORS = {
  top: recipeColor('#8a6240'),
  base: recipeColor('#6b4a2e'),
} satisfies Record<string, Color>;

export function conferenceTableRecipe(): PropRecipe {
  const w = 3.0;
  const d = 1.2;
  const h = 0.75;
  const parts: PropRecipePart[] = [
    { id: 'top', shape: 'box', position: { x: 0, y: h, z: 0 }, size: { width: w, height: 0.06, depth: d }, color: COLORS.top },
    { id: 'base', shape: 'box', position: { x: 0, y: h * 0.25, z: 0 }, size: { width: w * 0.35, height: h * 0.4, depth: d * 0.45 }, color: COLORS.base },
    { id: 'pedestal', shape: 'box', position: { x: 0, y: h * 0.55, z: 0 }, size: { width: w * 0.15, height: h * 0.3, depth: d * 0.2 }, color: COLORS.base },
  ];
  return { id: 'conferenceTable', parts };
}

export function conferenceTableParts(): PropPartSpec[] {
  return lowerPropRecipe(conferenceTableRecipe());
}
