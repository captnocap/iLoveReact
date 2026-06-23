import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const libraryShelfDef: PropKindDefinition = {
  kind: 'libraryShelf',
  label: 'Library Shelf',
  solid: true,
  footprintRadiusMeters: 0.4,
  heightMeters: 2.0,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'valuables', capacity: 6, spawnFillChance: 0.6, searchSeconds: 3, access: 'open' },
};

const COLORS = {
  wood: recipeColor('#6b4a2e'),
  woodDark: recipeColor('#4a3320'),
  book1: recipeColor('#8a4a32'),
  book2: recipeColor('#3a7d80'),
  book3: recipeColor('#c2362f'),
} satisfies Record<string, Color>;

export function libraryShelfRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'leftSide', shape: 'box', position: { x: -0.340, y: 1.000, z: 0 }, size: { width: 0.04, height: 2.000, depth: 0.360 }, color: COLORS.woodDark },
    { id: 'rightSide', shape: 'box', position: { x: 0.340, y: 1.000, z: 0 }, size: { width: 0.04, height: 2.000, depth: 0.360 }, color: COLORS.woodDark },
    { id: 'back', shape: 'box', position: { x: 0, y: 1.000, z: -0.170 }, size: { width: 0.720, height: 2.000, depth: 0.02 }, color: COLORS.wood },
    { id: 'top', shape: 'box', position: { x: 0, y: 1.980, z: 0 }, size: { width: 0.720, height: 0.04, depth: 0.360 }, color: COLORS.wood },
    { id: 'bottom', shape: 'box', position: { x: 0, y: 0.02, z: 0 }, size: { width: 0.720, height: 0.04, depth: 0.360 }, color: COLORS.wood },
    { id: 'shelf0', shape: 'box', position: { x: 0, y: 0.400, z: 0 }, size: { width: 0.660, height: 0.03, depth: 0.340 }, color: COLORS.woodDark },
    { id: 'books0a', shape: 'box', position: { x: -0.120, y: 0.480, z: 0.090 }, size: { width: 0.06, height: 0.16, depth: 0.12 }, color: COLORS.book1 },
    { id: 'books0b', shape: 'box', position: { x: 0.090, y: 0.460, z: 0.090 }, size: { width: 0.05, height: 0.12, depth: 0.14 }, color: COLORS.book2 },
    { id: 'books0c', shape: 'box', position: { x: 0.180, y: 0.470, z: 0.090 }, size: { width: 0.04, height: 0.14, depth: 0.1 }, color: COLORS.book3 },
    { id: 'shelf1', shape: 'box', position: { x: 0, y: 0.800, z: 0 }, size: { width: 0.660, height: 0.03, depth: 0.340 }, color: COLORS.woodDark },
    { id: 'books1a', shape: 'box', position: { x: -0.120, y: 0.880, z: 0.090 }, size: { width: 0.06, height: 0.16, depth: 0.12 }, color: COLORS.book1 },
    { id: 'books1b', shape: 'box', position: { x: 0.090, y: 0.860, z: 0.090 }, size: { width: 0.05, height: 0.12, depth: 0.14 }, color: COLORS.book2 },
    { id: 'books1c', shape: 'box', position: { x: 0.180, y: 0.870, z: 0.090 }, size: { width: 0.04, height: 0.14, depth: 0.1 }, color: COLORS.book3 },
    { id: 'shelf2', shape: 'box', position: { x: 0, y: 1.200, z: 0 }, size: { width: 0.660, height: 0.03, depth: 0.340 }, color: COLORS.woodDark },
    { id: 'books2a', shape: 'box', position: { x: -0.120, y: 1.280, z: 0.090 }, size: { width: 0.06, height: 0.16, depth: 0.12 }, color: COLORS.book1 },
    { id: 'books2b', shape: 'box', position: { x: 0.090, y: 1.260, z: 0.090 }, size: { width: 0.05, height: 0.12, depth: 0.14 }, color: COLORS.book2 },
    { id: 'books2c', shape: 'box', position: { x: 0.180, y: 1.270, z: 0.090 }, size: { width: 0.04, height: 0.14, depth: 0.1 }, color: COLORS.book3 },
    { id: 'shelf3', shape: 'box', position: { x: 0, y: 1.600, z: 0 }, size: { width: 0.660, height: 0.03, depth: 0.340 }, color: COLORS.woodDark },
    { id: 'books3a', shape: 'box', position: { x: -0.120, y: 1.680, z: 0.090 }, size: { width: 0.06, height: 0.16, depth: 0.12 }, color: COLORS.book1 },
    { id: 'books3b', shape: 'box', position: { x: 0.090, y: 1.660, z: 0.090 }, size: { width: 0.05, height: 0.12, depth: 0.14 }, color: COLORS.book2 },
    { id: 'books3c', shape: 'box', position: { x: 0.180, y: 1.670, z: 0.090 }, size: { width: 0.04, height: 0.14, depth: 0.1 }, color: COLORS.book3 },
  ];
  return { id: 'libraryShelf', parts };
}

export function libraryShelfParts(): PropPartSpec[] {
  return lowerPropRecipe(libraryShelfRecipe());
}
