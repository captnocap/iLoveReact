import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const dvdShelfDef: PropKindDefinition = {
  kind: 'dvdShelf',
  label: 'DVD Shelf',
  solid: true,
  footprintRadiusMeters: 0.4,
  heightMeters: 1.8,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'valuables', capacity: 4, spawnFillChance: 0.5, searchSeconds: 2, access: 'open' },
};

const COLORS = {
  wood: recipeColor('#6b4a2e'),
  case1: recipeColor('#1a1c1e'),
  case2: recipeColor('#3a3f46'),
  case3: recipeColor('#7d3b4a'),
} satisfies Record<string, Color>;

export function dvdShelfRecipe(): PropRecipe {
  const h = 1.8;
  const w = 0.7;
  const d = 0.18;
  const parts: PropRecipePart[] = [
    {
      id: 'leftSide',
      shape: 'box',
      position: { x: -w * 0.5, y: h * 0.5, z: 0 },
      size: { width: 0.04, height: h, depth: d },
      color: COLORS.wood,
    },
    {
      id: 'rightSide',
      shape: 'box',
      position: { x: w * 0.5, y: h * 0.5, z: 0 },
      size: { width: 0.04, height: h, depth: d },
      color: COLORS.wood,
    },
    {
      id: 'shelf1',
      shape: 'box',
      position: { x: 0, y: h * 0.2, z: 0 },
      size: { width: w, height: 0.03, depth: d },
      color: COLORS.wood,
    },
    {
      id: 'shelf2',
      shape: 'box',
      position: { x: 0, y: h * 0.45, z: 0 },
      size: { width: w, height: 0.03, depth: d },
      color: COLORS.wood,
    },
    {
      id: 'shelf3',
      shape: 'box',
      position: { x: 0, y: h * 0.7, z: 0 },
      size: { width: w, height: 0.03, depth: d },
      color: COLORS.wood,
    },
    {
      id: 'shelf4',
      shape: 'box',
      position: { x: 0, y: h * 0.95, z: 0 },
      size: { width: w, height: 0.03, depth: d },
      color: COLORS.wood,
    },
    {
      id: 'dvd1',
      shape: 'box',
      position: { x: -w * 0.2, y: h * 0.28, z: 0 },
      size: { width: 0.02, height: 0.12, depth: 0.14 },
      color: COLORS.case1,
    },
    {
      id: 'dvd2',
      shape: 'box',
      position: { x: 0, y: h * 0.53, z: 0 },
      size: { width: 0.02, height: 0.12, depth: 0.14 },
      color: COLORS.case2,
    },
    {
      id: 'dvd3',
      shape: 'box',
      position: { x: w * 0.2, y: h * 0.78, z: 0 },
      size: { width: 0.02, height: 0.12, depth: 0.14 },
      color: COLORS.case3,
    },
  ];
  return { id: 'dvdShelf', parts };
}

export function dvdShelfParts(): PropPartSpec[] {
  return lowerPropRecipe(dvdShelfRecipe());
}
