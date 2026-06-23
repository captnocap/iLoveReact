import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const storeShelfDef: PropKindDefinition = {
  kind: 'storeShelf',
  label: 'Store Shelf',
  solid: true,
  footprintRadiusMeters: 0.95,
  heightMeters: 1.9,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'kitchen', capacity: 6, spawnFillChance: 0.65, searchSeconds: 3, access: 'open' },
};

const COLORS = {
  metal: recipeColor('#9aa1ab'),
  metalDark: recipeColor('#6c727b'),
  box1: recipeColor('#c2362f'),
  box2: recipeColor('#3a7d80'),
  box3: recipeColor('#e8b84a'),
} satisfies Record<string, Color>;

export function storeShelfRecipe(): PropRecipe {
  const h = 1.9;
  const w = 1.8;
  const d = 0.5;
  const parts: PropRecipePart[] = [
    {
      id: 'leftPost',
      shape: 'box',
      position: { x: -w * 0.48, y: h * 0.5, z: 0 },
      size: { width: 0.04, height: h, depth: d },
      color: COLORS.metal,
    },
    {
      id: 'rightPost',
      shape: 'box',
      position: { x: w * 0.48, y: h * 0.5, z: 0 },
      size: { width: 0.04, height: h, depth: d },
      color: COLORS.metal,
    },
    {
      id: 'shelf1',
      shape: 'box',
      position: { x: 0, y: h * 0.2, z: 0 },
      size: { width: w, height: 0.03, depth: d },
      color: COLORS.metalDark,
    },
    {
      id: 'shelf2',
      shape: 'box',
      position: { x: 0, y: h * 0.45, z: 0 },
      size: { width: w, height: 0.03, depth: d },
      color: COLORS.metalDark,
    },
    {
      id: 'shelf3',
      shape: 'box',
      position: { x: 0, y: h * 0.7, z: 0 },
      size: { width: w, height: 0.03, depth: d },
      color: COLORS.metalDark,
    },
    {
      id: 'shelf4',
      shape: 'box',
      position: { x: 0, y: h * 0.95, z: 0 },
      size: { width: w, height: 0.03, depth: d },
      color: COLORS.metalDark,
    },
    {
      id: 'box1',
      shape: 'box',
      position: { x: -w * 0.25, y: h * 0.28, z: -d * 0.1 },
      size: { width: 0.25, height: 0.12, depth: 0.2 },
      color: COLORS.box1,
    },
    {
      id: 'box2',
      shape: 'box',
      position: { x: w * 0.05, y: h * 0.53, z: -d * 0.05 },
      size: { width: 0.2, height: 0.1, depth: 0.18 },
      color: COLORS.box2,
    },
    {
      id: 'box3',
      shape: 'box',
      position: { x: w * 0.3, y: h * 0.78, z: -d * 0.08 },
      size: { width: 0.22, height: 0.12, depth: 0.2 },
      color: COLORS.box3,
    },
  ];
  return { id: 'storeShelf', parts };
}

export function storeShelfParts(): PropPartSpec[] {
  return lowerPropRecipe(storeShelfRecipe());
}
