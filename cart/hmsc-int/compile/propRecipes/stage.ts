import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const stageDef: PropKindDefinition = {
  kind: 'stage',
  label: 'Stage',
  solid: true,
  footprintRadiusMeters: 2.0,
  heightMeters: 1.2,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'hard',
};

const COLORS = {
  deck: recipeColor('#22262b'),
  trim: recipeColor('#6b4a2e'),
  riser: recipeColor('#3a3f46'),
} satisfies Record<string, Color>;

export function stageRecipe(): PropRecipe {
  const w = 4.0;
  const d = 2.5;
  const h = 1.2;
  const parts: PropRecipePart[] = [
    { id: 'deck', shape: 'box', position: { x: 0, y: h, z: 0 }, size: { width: w, height: 0.12, depth: d }, color: COLORS.deck },
    { id: 'riser', shape: 'box', position: { x: 0, y: h / 2, z: 0 }, size: { width: w, height: h, depth: d }, color: COLORS.riser },
    { id: 'trimFront', shape: 'box', position: { x: 0, y: h / 2, z: -d / 2 - 0.01 }, size: { width: w, height: h, depth: 0.03 }, color: COLORS.trim },
    { id: 'trimSideL', shape: 'box', position: { x: -w / 2 - 0.01, y: h / 2, z: 0 }, size: { width: 0.03, height: h, depth: d }, color: COLORS.trim },
    { id: 'trimSideR', shape: 'box', position: { x: w / 2 + 0.01, y: h / 2, z: 0 }, size: { width: 0.03, height: h, depth: d }, color: COLORS.trim },
  ];
  return { id: 'stage', parts };
}

export function stageParts(): PropPartSpec[] {
  return lowerPropRecipe(stageRecipe());
}
