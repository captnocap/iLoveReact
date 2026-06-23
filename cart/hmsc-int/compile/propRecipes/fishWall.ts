import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const fishWallDef: PropKindDefinition = {
  kind: 'fishWall',
  label: 'Fish on a Wall',
  solid: true,
  footprintRadiusMeters: 0.08,
  heightMeters: 0.55,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'none',
};

const COLORS = {
  mount: recipeColor('#6b4a2e'),
  plaque: recipeColor('#8a6240'),
  fish: recipeColor('#3a7d80'),
  belly: recipeColor('#c2a878'),
  eye: recipeColor('#1a1c1e'),
} satisfies Record<string, Color>;

export function fishWallRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'plaque',
      shape: 'box',
      position: { x: 0, y: 0.28, z: 0.02 },
      size: { width: 0.7, height: 0.5, depth: 0.04 },
      color: COLORS.plaque,
    },
    {
      id: 'mountTop',
      shape: 'box',
      position: { x: 0, y: 0.52, z: 0.04 },
      size: { width: 0.12, height: 0.08, depth: 0.06 },
      color: COLORS.mount,
    },
    {
      id: 'body',
      shape: 'sphere',
      position: { x: 0, y: 0.3, z: 0.06 },
      size: { width: 0.5, height: 0.18, depth: 0.12 },
      color: COLORS.fish,
    },
    {
      id: 'belly',
      shape: 'sphere',
      position: { x: 0, y: 0.26, z: 0.08 },
      size: { width: 0.3, height: 0.08, depth: 0.08 },
      color: COLORS.belly,
    },
    {
      id: 'tail',
      shape: 'box',
      position: { x: -0.32, y: 0.3, z: 0.06 },
      size: { width: 0.14, height: 0.12, depth: 0.03 },
      color: COLORS.fish,
      rotation: { pitch: 0, yaw: 0, roll: -25 },
    },
    {
      id: 'head',
      shape: 'sphere',
      position: { x: 0.22, y: 0.3, z: 0.06 },
      size: { width: 0.16, height: 0.14, depth: 0.1 },
      color: COLORS.fish,
    },
    {
      id: 'eye',
      shape: 'sphere',
      position: { x: 0.28, y: 0.32, z: 0.1 },
      size: { width: 0.02, height: 0.02, depth: 0.02 },
      color: COLORS.eye,
    },
    {
      id: 'finTop',
      shape: 'box',
      position: { x: 0, y: 0.4, z: 0.08 },
      size: { width: 0.12, height: 0.08, depth: 0.02 },
      color: COLORS.fish,
      rotation: { pitch: 0, yaw: 0, roll: 25 },
    },
    {
      id: 'finBottom',
      shape: 'box',
      position: { x: 0.05, y: 0.2, z: 0.08 },
      size: { width: 0.1, height: 0.06, depth: 0.02 },
      color: COLORS.fish,
      rotation: { pitch: 0, yaw: 0, roll: -25 },
    },
  ];
  return { id: 'fishWall', parts };
}

export function fishWallParts(): PropPartSpec[] {
  return lowerPropRecipe(fishWallRecipe());
}
