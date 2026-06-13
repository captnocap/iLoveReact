import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const cupboardDef: PropKindDefinition = {
  kind: 'cupboard',
  label: 'Cupboard',
  // 1.0m wide, 0.5m deep — yaw-aware thin AABB in world props.
  solid: true,
  footprintRadiusMeters: 0.5,
  footprintDepthMeters: 0.5,
  heightMeters: 1.9,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'clothing', capacity: 4, spawnFillChance: 0.6, searchSeconds: 3, access: 'open' },
};

const COLORS = {
  wood: recipeColor('#8a6240'),
  woodDark: recipeColor('#6b4a2e'),
  metal: recipeColor('#3a3f46'),
} satisfies Record<string, Color>;

export function cupboardRecipe(heightMeters: number, footprintRadiusMeters: number): PropRecipe {
  const h = heightMeters;
  const w = footprintRadiusMeters * 2;
  const d = 0.5;
  const parts: PropRecipePart[] = [
    {
      id: 'plinth',
      shape: 'box',
      position: { x: 0, y: 0.04, z: 0 },
      size: { width: w, height: 0.08, depth: d },
      color: COLORS.woodDark,
    },
    {
      id: 'carcass',
      shape: 'box',
      position: { x: 0, y: h / 2, z: 0 },
      size: { width: w, height: h - 0.12, depth: d - 0.06 },
      color: COLORS.wood,
    },
    {
      id: 'top',
      shape: 'box',
      position: { x: 0, y: h - 0.03, z: 0 },
      size: { width: w + 0.04, height: 0.06, depth: d },
      color: COLORS.woodDark,
    },
    {
      id: 'leftDoor',
      shape: 'box',
      position: { x: -w * 0.24, y: h * 0.52, z: -d / 2 + 0.015 },
      size: { width: w * 0.44, height: h * 0.84, depth: 0.02 },
      color: COLORS.woodDark,
    },
    {
      id: 'rightDoor',
      shape: 'box',
      position: { x: w * 0.24, y: h * 0.52, z: -d / 2 + 0.015 },
      size: { width: w * 0.44, height: h * 0.84, depth: 0.02 },
      color: COLORS.woodDark,
    },
    {
      id: 'leftHandle',
      shape: 'box',
      position: { x: -w * 0.06, y: h * 0.55, z: -d / 2 - 0.005 },
      size: { width: 0.035, height: 0.035, depth: 0.035 },
      color: COLORS.metal,
    },
    {
      id: 'rightHandle',
      shape: 'box',
      position: { x: w * 0.06, y: h * 0.55, z: -d / 2 - 0.005 },
      size: { width: 0.035, height: 0.035, depth: 0.035 },
      color: COLORS.metal,
    },
  ];
  return { id: 'cupboard', parts };
}

export function cupboardParts(heightMeters: number, footprintRadiusMeters: number): PropPartSpec[] {
  return lowerPropRecipe(cupboardRecipe(heightMeters, footprintRadiusMeters));
}
