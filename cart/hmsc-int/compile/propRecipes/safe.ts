import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const safeDef: PropKindDefinition = {
  kind: 'safe',
  label: 'Safe',
  solid: true,
  footprintRadiusMeters: 0.4,
  heightMeters: 0.55,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'valuables', capacity: 4, spawnFillChance: 0.6, searchSeconds: 5, access: 'keyed' },
  coverClass: 'hard',
};

const COLORS = {
  body: recipeColor('#3a3f46'),
  dark: recipeColor('#22262b'),
  dial: recipeColor('#9aa1ab'),
} satisfies Record<string, Color>;

export function safeRecipe(): PropRecipe {
  const w = 0.8;
  const d = 0.6;
  const h = 0.55;
  const parts: PropRecipePart[] = [
    { id: 'body', shape: 'box', position: { x: 0, y: h / 2, z: 0 }, size: { width: w, height: h, depth: d }, color: COLORS.body },
    { id: 'door', shape: 'box', position: { x: 0, y: h / 2, z: -d / 2 - 0.005 }, size: { width: w * 0.85, height: h * 0.85, depth: 0.03 }, color: COLORS.dark },
    { id: 'dial', shape: 'box', position: { x: 0, y: h * 0.55, z: -d / 2 - 0.02 }, size: { width: 0.12, height: 0.12, depth: 0.03 }, color: COLORS.dial },
    { id: 'handle', shape: 'box', position: { x: 0, y: h * 0.35, z: -d / 2 - 0.02 }, size: { width: 0.06, height: 0.14, depth: 0.03 }, color: COLORS.dial },
  ];
  return { id: 'safe', parts };
}

export function safeParts(): PropPartSpec[] {
  return lowerPropRecipe(safeRecipe());
}
