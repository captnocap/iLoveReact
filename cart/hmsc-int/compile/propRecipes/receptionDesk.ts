import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const receptionDeskDef: PropKindDefinition = {
  kind: 'receptionDesk',
  label: 'Reception Desk',
  solid: true,
  footprintRadiusMeters: 1.0,
  footprintDepthMeters: 0.75,
  heightMeters: 1.15,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'office', capacity: 3, spawnFillChance: 0.4, searchSeconds: 2.5, access: 'open' },
  coverClass: 'soft',
};

const COLORS = {
  body: recipeColor('#d6d9dc'),
  accent: recipeColor('#3a7d80'),
  counter: recipeColor('#c2a878'),
} satisfies Record<string, Color>;

export function receptionDeskRecipe(): PropRecipe {
  const w = 2.0;
  const d = 0.75;
  const h = 1.15;
  const parts: PropRecipePart[] = [
    { id: 'lowerBody', shape: 'box', position: { x: 0, y: h * 0.45, z: 0 }, size: { width: w, height: h * 0.9, depth: d }, color: COLORS.body },
    { id: 'counter', shape: 'box', position: { x: 0, y: h, z: -d * 0.12 }, size: { width: w, height: 0.08, depth: d * 0.82 }, color: COLORS.counter },
    { id: 'frontPanel', shape: 'box', position: { x: 0, y: h * 0.45, z: d / 2 + 0.01 }, size: { width: w * 0.7, height: h * 0.7, depth: 0.03 }, color: COLORS.accent },
  ];
  return { id: 'receptionDesk', parts };
}

export function receptionDeskParts(): PropPartSpec[] {
  return lowerPropRecipe(receptionDeskRecipe());
}
