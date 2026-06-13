import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const ovenDef: PropKindDefinition = {
  kind: 'oven',
  label: 'Oven',
  solid: true,
  footprintRadiusMeters: 0.35,
  footprintDepthMeters: 0.62,
  heightMeters: 0.95,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'kitchen', capacity: 2, spawnFillChance: 0.35, searchSeconds: 2.5, access: 'open' },
};

const COLORS = {
  body: recipeColor('#d6d9dc'),
  dark: recipeColor('#aab0b6'),
  black: recipeColor('#22262b'),
  metal: recipeColor('#3a3f46'),
  burner: recipeColor('#33373c'),
} satisfies Record<string, Color>;

export function ovenRecipe(heightMeters: number, footprintRadiusMeters: number): PropRecipe {
  const h = heightMeters;
  const w = footprintRadiusMeters * 2;
  const d = 0.62;
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'box',
      position: { x: 0, y: h / 2, z: 0 },
      size: { width: w, height: h, depth: d },
      color: COLORS.body,
    },
    {
      id: 'cooktop',
      shape: 'box',
      position: { x: 0, y: h, z: 0 },
      size: { width: w, height: 0.025, depth: d },
      color: COLORS.black,
    },
    {
      id: 'burnerBackLeft',
      shape: 'cylinder8',
      position: { x: -w * 0.22, y: h + 0.012, z: -0.14 },
      radius: 0.085,
      height: 0.02,
      color: COLORS.burner,
    },
    {
      id: 'burnerBackRight',
      shape: 'cylinder8',
      position: { x: w * 0.22, y: h + 0.012, z: -0.14 },
      radius: 0.085,
      height: 0.02,
      color: COLORS.burner,
    },
    {
      id: 'burnerFrontLeft',
      shape: 'cylinder8',
      position: { x: -w * 0.22, y: h + 0.012, z: 0.14 },
      radius: 0.085,
      height: 0.02,
      color: COLORS.burner,
    },
    {
      id: 'burnerFrontRight',
      shape: 'cylinder8',
      position: { x: w * 0.22, y: h + 0.012, z: 0.14 },
      radius: 0.085,
      height: 0.02,
      color: COLORS.burner,
    },
    {
      id: 'door',
      shape: 'box',
      position: { x: 0, y: h * 0.42, z: -d / 2 + 0.005 },
      size: { width: w * 0.86, height: h * 0.5, depth: 0.02 },
      color: COLORS.dark,
    },
    {
      id: 'window',
      shape: 'box',
      position: { x: 0, y: h * 0.45, z: -d / 2 - 0.005 },
      size: { width: w * 0.6, height: h * 0.26, depth: 0.015 },
      color: COLORS.black,
    },
    {
      id: 'handle',
      shape: 'box',
      position: { x: 0, y: h * 0.72, z: -d / 2 - 0.02 },
      size: { width: w * 0.8, height: 0.035, depth: 0.035 },
      color: COLORS.metal,
    },
  ];
  return { id: 'oven', parts };
}

export function ovenParts(heightMeters: number, footprintRadiusMeters: number): PropPartSpec[] {
  return lowerPropRecipe(ovenRecipe(heightMeters, footprintRadiusMeters));
}
