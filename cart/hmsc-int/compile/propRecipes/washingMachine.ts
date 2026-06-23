import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const washingMachineDef: PropKindDefinition = {
  kind: 'washingMachine',
  label: 'Washing Machine',
  solid: true,
  footprintRadiusMeters: 0.38,
  footprintDepthMeters: 0.6,
  heightMeters: 0.95,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'clothing', capacity: 3, spawnFillChance: 0.4, searchSeconds: 2.5, access: 'open' },
};

const COLORS = {
  body: recipeColor('#d6d9dc'),
  dark: recipeColor('#aab0b6'),
  glass: recipeColor('#2c4a66'),
} satisfies Record<string, Color>;

export function washingMachineRecipe(): PropRecipe {
  const w = 0.76;
  const d = 0.6;
  const h = 0.95;
  const parts: PropRecipePart[] = [
    { id: 'body', shape: 'box', position: { x: 0, y: h / 2, z: 0 }, size: { width: w, height: h, depth: d }, color: COLORS.body },
    { id: 'door', shape: 'cylinder8', position: { x: 0, y: h * 0.45, z: -d / 2 - 0.005 }, radius: 0.22, height: 0.02, color: COLORS.glass },
    { id: 'panel', shape: 'box', position: { x: 0, y: h * 0.85, z: -d / 2 - 0.005 }, size: { width: w * 0.65, height: 0.12, depth: 0.01 }, color: COLORS.dark },
    { id: 'knob', shape: 'box', position: { x: w * 0.18, y: h * 0.85, z: -d / 2 - 0.015 }, size: { width: 0.04, height: 0.04, depth: 0.02 }, color: COLORS.body },
  ];
  return { id: 'washingMachine', parts };
}

export function washingMachineParts(): PropPartSpec[] {
  return lowerPropRecipe(washingMachineRecipe());
}
