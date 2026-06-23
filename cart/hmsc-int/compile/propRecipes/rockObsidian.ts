import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const rockObsidianDef: PropKindDefinition = {
  kind: 'rockObsidian',
  label: 'Obsidian Rock',
  solid: true,
  footprintRadiusMeters: 0.5,
  heightMeters: 0.85,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  glass: recipeColor('#1a1c1e'),
  shine: recipeColor('#4a4a52'),
  crack: recipeColor('#0f1012'),
} satisfies Record<string, Color>;

export function rockObsidianRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'shard1', shape: 'box', position: { x: 0, y: 0.34, z: 0 }, size: { width: 0.75, height: 0.58, depth: 0.55 }, color: COLORS.glass, rotation: { pitch: 8, yaw: 35, roll: -12 } },
    { id: 'shard2', shape: 'box', position: { x: 0.24, y: 0.48, z: 0.18 }, size: { width: 0.36, height: 0.52, depth: 0.3 }, color: COLORS.shine, rotation: { pitch: -10, yaw: -25, roll: 15 } },
    { id: 'shard3', shape: 'box', position: { x: -0.18, y: 0.3, z: -0.15 }, size: { width: 0.42, height: 0.38, depth: 0.36 }, color: COLORS.glass, rotation: { pitch: 5, yaw: 60, roll: -8 } },
    { id: 'shard4', shape: 'box', position: { x: 0.12, y: 0.68, z: -0.22 }, size: { width: 0.28, height: 0.45, depth: 0.22 }, color: COLORS.shine, rotation: { pitch: -14, yaw: 15, roll: 22 } },
    { id: 'shard5', shape: 'box', position: { x: -0.3, y: 0.22, z: 0.18 }, size: { width: 0.32, height: 0.24, depth: 0.28 }, color: COLORS.crack, rotation: { pitch: 10, yaw: -55, roll: -5 } },
    { id: 'chip1', shape: 'box', position: { x: 0.42, y: 0.12, z: -0.08 }, size: { width: 0.18, height: 0.1, depth: 0.2 }, color: COLORS.crack, rotation: { pitch: 20, yaw: 40, roll: 10 } },
    { id: 'chip2', shape: 'box', position: { x: -0.1, y: 0.14, z: 0.35 }, size: { width: 0.2, height: 0.1, depth: 0.16 }, color: COLORS.shine, rotation: { pitch: -12, yaw: 80, roll: -8 } },
  ];
  return { id: 'rockObsidian', parts };
}

export function rockObsidianParts(): PropPartSpec[] {
  return lowerPropRecipe(rockObsidianRecipe());
}
