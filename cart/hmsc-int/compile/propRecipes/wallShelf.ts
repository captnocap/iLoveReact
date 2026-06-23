import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const wallShelfDef: PropKindDefinition = {
  kind: 'wallShelf',
  label: 'Wall Shelf',
  solid: true,
  footprintRadiusMeters: 0.5,
  footprintDepthMeters: 0.25,
  heightMeters: 0.08,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'none',
};

const COLORS = {
  wood: recipeColor('#8a6240'),
  bracket: recipeColor('#6b4a2e'),
} satisfies Record<string, Color>;

export function wallShelfRecipe(): PropRecipe {
  const w = 1.0;
  const d = 0.25;
  const parts: PropRecipePart[] = [
    { id: 'board', shape: 'box', position: { x: 0, y: 0.04, z: d / 2 }, size: { width: w, height: 0.04, depth: d }, color: COLORS.wood },
    { id: 'leftBracket', shape: 'box', position: { x: -w * 0.35, y: -0.02, z: 0.02 }, size: { width: 0.03, height: 0.08, depth: 0.12 }, color: COLORS.bracket, rotation: { pitch: -30, yaw: 0, roll: 0 } },
    { id: 'rightBracket', shape: 'box', position: { x: w * 0.35, y: -0.02, z: 0.02 }, size: { width: 0.03, height: 0.08, depth: 0.12 }, color: COLORS.bracket, rotation: { pitch: -30, yaw: 0, roll: 0 } },
  ];
  return { id: 'wallShelf', parts };
}

export function wallShelfParts(): PropPartSpec[] {
  return lowerPropRecipe(wallShelfRecipe());
}
