import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const storageShelfDef: PropKindDefinition = {
  kind: 'storageShelf',
  label: 'Storage Shelf',
  solid: true,
  footprintRadiusMeters: 0.7,
  heightMeters: 1.9,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'tools', capacity: 6, spawnFillChance: 0.55, searchSeconds: 2.5, access: 'open' },
  coverClass: 'soft',
};

const COLORS = {
  metal: recipeColor('#6c727b'),
  dark: recipeColor('#3a3f46'),
} satisfies Record<string, Color>;

export function storageShelfRecipe(): PropRecipe {
  const w = 1.4;
  const d = 0.55;
  const h = 1.9;
  const parts: PropRecipePart[] = [
    { id: 'leftPost', shape: 'box', position: { x: -w / 2 + 0.02, y: h / 2, z: 0 }, size: { width: 0.04, height: h, depth: d }, color: COLORS.metal },
    { id: 'rightPost', shape: 'box', position: { x: w / 2 - 0.02, y: h / 2, z: 0 }, size: { width: 0.04, height: h, depth: d }, color: COLORS.metal },
    { id: 'shelf1', shape: 'box', position: { x: 0, y: 0.06, z: 0 }, size: { width: w, height: 0.04, depth: d }, color: COLORS.dark },
    { id: 'shelf2', shape: 'box', position: { x: 0, y: h * 0.34, z: 0 }, size: { width: w, height: 0.04, depth: d }, color: COLORS.dark },
    { id: 'shelf3', shape: 'box', position: { x: 0, y: h * 0.66, z: 0 }, size: { width: w, height: 0.04, depth: d }, color: COLORS.dark },
    { id: 'shelf4', shape: 'box', position: { x: 0, y: h - 0.06, z: 0 }, size: { width: w, height: 0.04, depth: d }, color: COLORS.dark },
  ];
  return { id: 'storageShelf', parts };
}

export function storageShelfParts(): PropPartSpec[] {
  return lowerPropRecipe(storageShelfRecipe());
}
