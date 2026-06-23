import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const rockJaggedDef: PropKindDefinition = {
  kind: 'rockJagged',
  label: 'Jagged Rock',
  solid: true,
  footprintRadiusMeters: 0.7,
  heightMeters: 1.4,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  base: recipeColor('#6b7079'),
  light: recipeColor('#82868d'),
  dark: recipeColor('#52565d'),
} satisfies Record<string, Color>;

export function rockJaggedRecipe(): PropRecipe {
  const h = 1.4;
  const r = 0.7;
  const parts: PropRecipePart[] = [
    {
      id: 'spine',
      shape: 'box',
      position: { x: 0, y: h * 0.5, z: 0 },
      size: { width: r * 0.5, height: h * 0.95, depth: r * 0.5 },
      color: COLORS.base,
      rotation: { pitch: 10, yaw: 0, roll: 8 },
    },
    {
      id: 'shard1',
      shape: 'box',
      position: { x: r * 0.15, y: h * 0.65, z: r * 0.05 },
      size: { width: r * 0.35, height: h * 0.7, depth: r * 0.3 },
      color: COLORS.light,
      rotation: { pitch: 25, yaw: 30, roll: -15 },
    },
    {
      id: 'shard2',
      shape: 'box',
      position: { x: -r * 0.1, y: h * 0.55, z: -r * 0.1 },
      size: { width: r * 0.4, height: h * 0.6, depth: r * 0.25 },
      color: COLORS.dark,
      rotation: { pitch: -20, yaw: -20, roll: 20 },
    },
    {
      id: 'shard3',
      shape: 'box',
      position: { x: r * 0.05, y: h * 0.8, z: -r * 0.05 },
      size: { width: r * 0.25, height: h * 0.45, depth: r * 0.2 },
      color: COLORS.light,
      rotation: { pitch: 35, yaw: -10, roll: 5 },
    },
  ];
  return { id: 'rockJagged', parts };
}

export function rockJaggedParts(): PropPartSpec[] {
  return lowerPropRecipe(rockJaggedRecipe());
}
