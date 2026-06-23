import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const bookcaseDef: PropKindDefinition = {
  kind: 'bookcase',
  label: 'Bookcase',
  solid: true,
  footprintRadiusMeters: 0.55,
  footprintDepthMeters: 0.4,
  heightMeters: 2.0,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'office', capacity: 4, spawnFillChance: 0.5, searchSeconds: 2.5, access: 'open' },
  coverClass: 'soft',
};

const COLORS = {
  wood: recipeColor('#8a6240'),
  woodDark: recipeColor('#6b4a2e'),
  book: recipeColor('#3a7d80'),
} satisfies Record<string, Color>;

export function bookcaseRecipe(): PropRecipe {
  const w = 1.1;
  const d = 0.4;
  const h = 2.0;
  const parts: PropRecipePart[] = [
    { id: 'back', shape: 'box', position: { x: 0, y: h / 2, z: d / 2 - 0.02 }, size: { width: w, height: h, depth: 0.04 }, color: COLORS.wood },
    { id: 'leftSide', shape: 'box', position: { x: -w / 2 + 0.02, y: h / 2, z: 0 }, size: { width: 0.04, height: h, depth: d }, color: COLORS.wood },
    { id: 'rightSide', shape: 'box', position: { x: w / 2 - 0.02, y: h / 2, z: 0 }, size: { width: 0.04, height: h, depth: d }, color: COLORS.wood },
    { id: 'top', shape: 'box', position: { x: 0, y: h - 0.02, z: 0 }, size: { width: w, height: 0.04, depth: d }, color: COLORS.woodDark },
    { id: 'shelf1', shape: 'box', position: { x: 0, y: h * 0.26, z: 0 }, size: { width: w * 0.92, height: 0.03, depth: d * 0.92 }, color: COLORS.woodDark },
    { id: 'shelf2', shape: 'box', position: { x: 0, y: h * 0.5, z: 0 }, size: { width: w * 0.92, height: 0.03, depth: d * 0.92 }, color: COLORS.woodDark },
    { id: 'shelf3', shape: 'box', position: { x: 0, y: h * 0.74, z: 0 }, size: { width: w * 0.92, height: 0.03, depth: d * 0.92 }, color: COLORS.woodDark },
    { id: 'books', shape: 'box', position: { x: -w * 0.12, y: h * 0.53, z: 0 }, size: { width: w * 0.35, height: 0.18, depth: d * 0.65 }, color: COLORS.book },
  ];
  return { id: 'bookcase', parts };
}

export function bookcaseParts(): PropPartSpec[] {
  return lowerPropRecipe(bookcaseRecipe());
}
