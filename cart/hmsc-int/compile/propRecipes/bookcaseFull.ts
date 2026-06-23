import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const bookcaseFullDef: PropKindDefinition = {
  kind: 'bookcaseFull',
  label: 'Full Bookcase',
  solid: true,
  footprintRadiusMeters: 0.35,
  heightMeters: 1.8,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'valuables', capacity: 5, spawnFillChance: 0.5, searchSeconds: 3, access: 'open' },
};

const COLORS = {
  wood: recipeColor('#6b4a2e'),
  woodDark: recipeColor('#4a3320'),
  book1: recipeColor('#8a4a32'),
  book2: recipeColor('#3a7d80'),
  book3: recipeColor('#c2362f'),
} satisfies Record<string, Color>;

export function bookcaseFullRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'leftSide', shape: 'box', position: { x: -0.295, y: 0.900, z: 0 }, size: { width: 0.04, height: 1.800, depth: 0.315 }, color: COLORS.woodDark },
    { id: 'rightSide', shape: 'box', position: { x: 0.295, y: 0.900, z: 0 }, size: { width: 0.04, height: 1.800, depth: 0.315 }, color: COLORS.woodDark },
    { id: 'back', shape: 'box', position: { x: 0, y: 0.900, z: -0.147 }, size: { width: 0.630, height: 1.800, depth: 0.02 }, color: COLORS.wood },
    { id: 'top', shape: 'box', position: { x: 0, y: 1.780, z: 0 }, size: { width: 0.630, height: 0.04, depth: 0.315 }, color: COLORS.wood },
    { id: 'bottom', shape: 'box', position: { x: 0, y: 0.02, z: 0 }, size: { width: 0.630, height: 0.04, depth: 0.315 }, color: COLORS.wood },
    { id: 'shelf0', shape: 'box', position: { x: 0, y: 0.360, z: 0 }, size: { width: 0.570, height: 0.03, depth: 0.295 }, color: COLORS.woodDark },
    { id: 'books0a', shape: 'box', position: { x: -0.105, y: 0.440, z: 0.079 }, size: { width: 0.06, height: 0.16, depth: 0.12 }, color: COLORS.book1 },
    { id: 'books0b', shape: 'box', position: { x: 0.079, y: 0.420, z: 0.079 }, size: { width: 0.05, height: 0.12, depth: 0.14 }, color: COLORS.book2 },
    { id: 'books0c', shape: 'box', position: { x: 0.158, y: 0.430, z: 0.079 }, size: { width: 0.04, height: 0.14, depth: 0.1 }, color: COLORS.book3 },
    { id: 'shelf1', shape: 'box', position: { x: 0, y: 0.720, z: 0 }, size: { width: 0.570, height: 0.03, depth: 0.295 }, color: COLORS.woodDark },
    { id: 'books1a', shape: 'box', position: { x: -0.105, y: 0.800, z: 0.079 }, size: { width: 0.06, height: 0.16, depth: 0.12 }, color: COLORS.book1 },
    { id: 'books1b', shape: 'box', position: { x: 0.079, y: 0.780, z: 0.079 }, size: { width: 0.05, height: 0.12, depth: 0.14 }, color: COLORS.book2 },
    { id: 'books1c', shape: 'box', position: { x: 0.158, y: 0.790, z: 0.079 }, size: { width: 0.04, height: 0.14, depth: 0.1 }, color: COLORS.book3 },
    { id: 'shelf2', shape: 'box', position: { x: 0, y: 1.080, z: 0 }, size: { width: 0.570, height: 0.03, depth: 0.295 }, color: COLORS.woodDark },
    { id: 'books2a', shape: 'box', position: { x: -0.105, y: 1.160, z: 0.079 }, size: { width: 0.06, height: 0.16, depth: 0.12 }, color: COLORS.book1 },
    { id: 'books2b', shape: 'box', position: { x: 0.079, y: 1.140, z: 0.079 }, size: { width: 0.05, height: 0.12, depth: 0.14 }, color: COLORS.book2 },
    { id: 'books2c', shape: 'box', position: { x: 0.158, y: 1.150, z: 0.079 }, size: { width: 0.04, height: 0.14, depth: 0.1 }, color: COLORS.book3 },
    { id: 'shelf3', shape: 'box', position: { x: 0, y: 1.440, z: 0 }, size: { width: 0.570, height: 0.03, depth: 0.295 }, color: COLORS.woodDark },
    { id: 'books3a', shape: 'box', position: { x: -0.105, y: 1.520, z: 0.079 }, size: { width: 0.06, height: 0.16, depth: 0.12 }, color: COLORS.book1 },
    { id: 'books3b', shape: 'box', position: { x: 0.079, y: 1.500, z: 0.079 }, size: { width: 0.05, height: 0.12, depth: 0.14 }, color: COLORS.book2 },
    { id: 'books3c', shape: 'box', position: { x: 0.158, y: 1.510, z: 0.079 }, size: { width: 0.04, height: 0.14, depth: 0.1 }, color: COLORS.book3 },
  ];
  return { id: 'bookcaseFull', parts };
}

export function bookcaseFullParts(): PropPartSpec[] {
  return lowerPropRecipe(bookcaseFullRecipe());
}
