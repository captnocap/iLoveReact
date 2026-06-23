import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const microwaveDef: PropKindDefinition = {
  kind: 'microwave',
  label: 'Microwave',
  solid: true,
  footprintRadiusMeters: 0.35,
  footprintDepthMeters: 0.4,
  heightMeters: 0.28,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
  container: { lootCategory: 'kitchen', capacity: 1, spawnFillChance: 0.4, searchSeconds: 1.5, access: 'open' },
};

const COLORS = {
  body: recipeColor('#d6d9dc'),
  dark: recipeColor('#aab0b6'),
  glass: recipeColor('#2c4a66'),
} satisfies Record<string, Color>;

export function microwaveRecipe(): PropRecipe {
  const w = 0.7;
  const d = 0.4;
  const h = 0.28;
  const parts: PropRecipePart[] = [
    { id: 'body', shape: 'box', position: { x: 0, y: h / 2, z: 0 }, size: { width: w, height: h, depth: d }, color: COLORS.body },
    { id: 'door', shape: 'box', position: { x: -w * 0.18, y: h / 2, z: -d / 2 - 0.005 }, size: { width: w * 0.55, height: h * 0.7, depth: 0.01 }, color: COLORS.glass },
    { id: 'panel', shape: 'box', position: { x: w * 0.27, y: h / 2, z: -d / 2 - 0.005 }, size: { width: w * 0.25, height: h * 0.7, depth: 0.01 }, color: COLORS.dark },
    { id: 'knob', shape: 'box', position: { x: w * 0.34, y: h * 0.6, z: -d / 2 - 0.015 }, size: { width: 0.04, height: 0.04, depth: 0.02 }, color: COLORS.body },
  ];
  return { id: 'microwave', parts };
}

export function microwaveParts(): PropPartSpec[] {
  return lowerPropRecipe(microwaveRecipe());
}
