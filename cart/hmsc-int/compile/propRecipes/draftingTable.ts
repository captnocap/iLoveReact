import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const draftingTableDef: PropKindDefinition = {
  kind: 'draftingTable',
  label: 'Drafting Table',
  solid: true,
  footprintRadiusMeters: 0.7,
  heightMeters: 1.0,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'soft',
};

const COLORS = {
  top: recipeColor('#c2a878'),
  leg: recipeColor('#6b4a2e'),
  edge: recipeColor('#8a6240'),
} satisfies Record<string, Color>;

export function draftingTableRecipe(): PropRecipe {
  const w = 1.4;
  const d = 0.85;
  const h = 1.0;
  const parts: PropRecipePart[] = [
    { id: 'leftLeg', shape: 'box', position: { x: -w * 0.35, y: h / 2, z: 0 }, size: { width: 0.07, height: h, depth: d * 0.7 }, color: COLORS.leg, rotation: { pitch: 0, yaw: 0, roll: -6 } },
    { id: 'rightLeg', shape: 'box', position: { x: w * 0.35, y: h / 2, z: 0 }, size: { width: 0.07, height: h, depth: d * 0.7 }, color: COLORS.leg, rotation: { pitch: 0, yaw: 0, roll: 6 } },
    { id: 'top', shape: 'box', position: { x: 0, y: h, z: 0 }, size: { width: w, height: 0.05, depth: d }, color: COLORS.top, rotation: { pitch: -12, yaw: 0, roll: 0 } },
    { id: 'frontEdge', shape: 'box', position: { x: 0, y: h - 0.08, z: d * 0.46 }, size: { width: w, height: 0.04, depth: 0.04 }, color: COLORS.edge },
  ];
  return { id: 'draftingTable', parts };
}

export function draftingTableParts(): PropPartSpec[] {
  return lowerPropRecipe(draftingTableRecipe());
}
