import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const displayShelfDef: PropKindDefinition = {
  kind: 'displayShelf',
  label: 'Display Shelf',
  solid: true,
  footprintRadiusMeters: 0.6,
  heightMeters: 1.6,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'valuables', capacity: 4, spawnFillChance: 0.5, searchSeconds: 2.5, access: 'open' },
  coverClass: 'soft',
};

const COLORS = {
  body: recipeColor('#22262b'),
  glass: recipeColor('#bcd3dd'),
} satisfies Record<string, Color>;

export function displayShelfRecipe(): PropRecipe {
  const w = 1.2;
  const d = 0.45;
  const h = 1.6;
  const parts: PropRecipePart[] = [
    { id: 'back', shape: 'box', position: { x: 0, y: h / 2, z: d / 2 - 0.02 }, size: { width: w, height: h, depth: 0.04 }, color: COLORS.body },
    { id: 'sideLeft', shape: 'box', position: { x: -w / 2 + 0.02, y: h / 2, z: 0 }, size: { width: 0.04, height: h, depth: d }, color: COLORS.body },
    { id: 'sideRight', shape: 'box', position: { x: w / 2 - 0.02, y: h / 2, z: 0 }, size: { width: 0.04, height: h, depth: d }, color: COLORS.body },
    { id: 'shelf1', shape: 'box', position: { x: 0, y: h * 0.28, z: 0 }, size: { width: w * 0.92, height: 0.03, depth: d * 0.92 }, color: COLORS.glass, opacity: 0.4 },
    { id: 'shelf2', shape: 'box', position: { x: 0, y: h * 0.54, z: 0 }, size: { width: w * 0.92, height: 0.03, depth: d * 0.92 }, color: COLORS.glass, opacity: 0.4 },
    { id: 'shelf3', shape: 'box', position: { x: 0, y: h * 0.8, z: 0 }, size: { width: w * 0.92, height: 0.03, depth: d * 0.92 }, color: COLORS.glass, opacity: 0.4 },
  ];
  return { id: 'displayShelf', parts };
}

export function displayShelfParts(): PropPartSpec[] {
  return lowerPropRecipe(displayShelfRecipe());
}
