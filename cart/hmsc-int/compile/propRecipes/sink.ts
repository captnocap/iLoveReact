import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const sinkDef: PropKindDefinition = {
  kind: 'sink',
  label: 'Sink',
  solid: true,
  footprintRadiusMeters: 0.3,
  footprintDepthMeters: 0.5,
  heightMeters: 0.9,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'bathroom', capacity: 2, spawnFillChance: 0.3, searchSeconds: 2, access: 'open' },
  coverClass: 'soft',
};

const COLORS = {
  porcelain: recipeColor('#eef0f2'),
  fixture: recipeColor('#aab0b6'),
} satisfies Record<string, Color>;

export function sinkRecipe(heightMeters: number): PropRecipe {
  const h = heightMeters;
  const parts: PropRecipePart[] = [
    {
      id: 'pedestal',
      shape: 'cylinder8',
      position: { x: 0, y: h * 0.39, z: 0 },
      radius: 0.09,
      height: h * 0.78,
      color: COLORS.porcelain,
    },
    {
      id: 'basin',
      shape: 'sphere',
      position: { x: 0, y: h * 0.82, z: 0 },
      size: { width: 0.54, height: 0.23, depth: 0.46 },
      color: COLORS.porcelain,
    },
    {
      id: 'rim',
      shape: 'box',
      position: { x: 0, y: h * 0.88, z: 0 },
      size: { width: 0.56, height: 0.04, depth: 0.46 },
      color: COLORS.porcelain,
    },
    {
      id: 'faucetStem',
      shape: 'cylinder8',
      position: { x: 0, y: h * 0.96, z: 0.16 },
      radius: 0.022,
      height: 0.16,
      color: COLORS.fixture,
    },
    {
      id: 'faucetSpout',
      shape: 'cylinder8',
      position: { x: 0, y: h + 0.03, z: 0.09 },
      radius: 0.018,
      height: 0.14,
      color: COLORS.fixture,
      rotation: { pitch: 90, yaw: 0, roll: 0 },
    },
  ];
  return { id: 'sink', parts };
}

export function sinkParts(heightMeters: number): PropPartSpec[] {
  return lowerPropRecipe(sinkRecipe(heightMeters));
}
