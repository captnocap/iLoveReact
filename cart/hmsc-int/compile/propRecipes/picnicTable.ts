import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const picnicTableDef: PropKindDefinition = {
  kind: 'picnicTable',
  label: 'Picnic Table',
  solid: true,
  footprintRadiusMeters: 1.0,
  heightMeters: 0.78,
  tileKind: 'wall',
  trafficControl: 'none',
  seat: { pose: 'sit', seatHeightMeters: 0.45, capacity: 4 },
};

const COLORS = {
  wood: recipeColor('#8a6240'),
  woodDark: recipeColor('#6b4a2e'),
} satisfies Record<string, Color>;

export function picnicTableRecipe(): PropRecipe {
  const h = 0.78;
  const w = 1.8;
  const d = 1.5;
  const parts: PropRecipePart[] = [
    {
      id: 'top',
      shape: 'box',
      position: { x: 0, y: h - 0.02, z: 0 },
      size: { width: w, height: 0.06, depth: 0.8 },
      color: COLORS.wood,
    },
    {
      id: 'seatLeft',
      shape: 'box',
      position: { x: 0, y: 0.45, z: -0.55 },
      size: { width: w, height: 0.05, depth: 0.25 },
      color: COLORS.wood,
    },
    {
      id: 'seatRight',
      shape: 'box',
      position: { x: 0, y: 0.45, z: 0.55 },
      size: { width: w, height: 0.05, depth: 0.25 },
      color: COLORS.wood,
    },
    {
      id: 'legA',
      shape: 'box',
      position: { x: -w * 0.35, y: h * 0.45, z: 0 },
      size: { width: 0.08, height: h, depth: d * 0.9 },
      color: COLORS.woodDark,
      rotation: { pitch: 0, yaw: 0, roll: 15 },
    },
    {
      id: 'legB',
      shape: 'box',
      position: { x: w * 0.35, y: h * 0.45, z: 0 },
      size: { width: 0.08, height: h, depth: d * 0.9 },
      color: COLORS.woodDark,
      rotation: { pitch: 0, yaw: 0, roll: -15 },
    },
  ];
  return { id: 'picnicTable', parts };
}

export function picnicTableParts(): PropPartSpec[] {
  return lowerPropRecipe(picnicTableRecipe());
}
