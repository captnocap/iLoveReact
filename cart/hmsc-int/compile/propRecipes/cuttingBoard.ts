import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const cuttingBoardDef: PropKindDefinition = {
  kind: 'cuttingBoard',
  label: 'Cutting Board',
  solid: true,
  footprintRadiusMeters: 0.2,
  heightMeters: 0.04,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'none',
};

const COLORS = {
  body: recipeColor('#8a6240'),
  accent: recipeColor('#674930'),
  detail: recipeColor('#a5754c'),
} satisfies Record<string, Color>;

export function cuttingBoardRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'base', shape: 'box', position: { x: 0, y: 0.018, z: 0 }, size: { width: 0.280, height: 0.028, depth: 0.200 }, color: COLORS.body },
    { id: 'accent', shape: 'box', position: { x: 0, y: 0.032, z: 0 }, size: { width: 0.200, height: 0.006, depth: 0.160 }, color: COLORS.accent },
    { id: 'detail', shape: 'cylinder8', position: { x: 0.100, y: 0.020, z: 0 }, radius: 0.024, height: 0.016, color: COLORS.detail },
  ];
  return { id: 'cuttingBoard', parts };
}

export function cuttingBoardParts(): PropPartSpec[] {
  return lowerPropRecipe(cuttingBoardRecipe());
}
