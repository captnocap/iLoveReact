import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const trashCanDef: PropKindDefinition = {
  kind: 'trashCan',
  label: 'Trash Can',
  solid: true,
  footprintRadiusMeters: 0.3,
  // PROPSCALE-0611: real public can ~1.0m × 1.15
  heightMeters: 1.15,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'junk', capacity: 3, spawnFillChance: 0.6, searchSeconds: 2.5, access: 'open' },
  coverClass: 'soft',
  dynamics: { bodyRadiusMeters: 0.44, restitution: 0.22 },
};

const COLORS = {
  body: recipeColor('#3f5747'),
  dark: recipeColor('#32463a'),
} satisfies Record<string, Color>;

export function trashCanRecipe(heightMeters: number, footprintRadiusMeters: number): PropRecipe {
  const h = heightMeters;
  const r = footprintRadiusMeters;
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'cylinder16',
      position: { x: 0, y: h * 0.41, z: 0 },
      radius: r * 0.92,
      height: h * 0.78,
      color: COLORS.body,
    },
    {
      id: 'rim',
      shape: 'cylinder16',
      position: { x: 0, y: h * 0.82, z: 0 },
      radius: r,
      height: h * 0.05,
      color: COLORS.dark,
    },
    {
      id: 'lid',
      shape: 'sphere',
      position: { x: 0, y: h * 0.84, z: 0 },
      size: { width: r * 2, height: h * 0.45, depth: r * 2 },
      color: COLORS.dark,
    },
    {
      id: 'flap',
      shape: 'box',
      position: { x: 0, y: h * 0.86, z: -r * 0.7 },
      size: { width: r * 1.1, height: h * 0.16, depth: 0.02 },
      color: COLORS.body,
      rotation: { pitch: 18, yaw: 0, roll: 0 },
    },
  ];
  return { id: 'trashCan', parts };
}

export function trashCanParts(heightMeters: number, footprintRadiusMeters: number): PropPartSpec[] {
  return lowerPropRecipe(trashCanRecipe(heightMeters, footprintRadiusMeters));
}
