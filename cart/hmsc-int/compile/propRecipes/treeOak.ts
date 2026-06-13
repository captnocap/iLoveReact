import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const treeOakDef: PropKindDefinition = {
  kind: 'treeOak',
  label: 'Oak Tree',
  solid: true,
  footprintRadiusMeters: 0.5,
  heightMeters: 17,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  bark: recipeColor('#5c4631'),
  darkLeaves: recipeColor('#1f4a20'),
  midLeaves: recipeColor('#2f6b2f'),
  lightLeaves: recipeColor('#43883a'),
} satisfies Record<string, Color>;

export function treeOakRecipe(kind: string, heightMeters: number, footprintRadiusMeters: number): PropRecipe {
  const h = heightMeters;
  const r = footprintRadiusMeters;
  const c = h * 0.32;
  const parts: PropRecipePart[] = [
    {
      id: 'trunk',
      shape: 'cylinder8',
      position: { x: 0, y: h * 0.24, z: 0 },
      radius: r,
      height: h * 0.48,
      color: COLORS.bark,
    },
    {
      id: 'mainCanopy',
      shape: 'sphere',
      position: { x: 0, y: h * 0.66, z: 0 },
      size: { width: c * 2, height: c * 1.7, depth: c * 2 },
      color: COLORS.midLeaves,
    },
    {
      id: 'rightCanopyLobe',
      shape: 'sphere',
      position: { x: c * 0.7, y: h * 0.58, z: c * 0.25 },
      size: { width: c * 1.3, height: c * 1.1, depth: c * 1.3 },
      color: COLORS.darkLeaves,
    },
    {
      id: 'leftBackCanopyLobe',
      shape: 'sphere',
      position: { x: -c * 0.65, y: h * 0.6, z: -c * 0.3 },
      size: { width: c * 1.2, height: c, depth: c * 1.2 },
      color: COLORS.lightLeaves,
    },
    {
      id: 'frontCanopyLobe',
      shape: 'sphere',
      position: { x: c * 0.15, y: h * 0.62, z: -c * 0.7 },
      size: { width: c * 1.1, height: c, depth: c * 1.1 },
      color: COLORS.darkLeaves,
    },
    {
      id: 'rearCanopyLobe',
      shape: 'sphere',
      position: { x: -c * 0.2, y: h * 0.6, z: c * 0.68 },
      size: { width: c * 1.1, height: c * 0.96, depth: c * 1.1 },
      color: COLORS.lightLeaves,
    },
    {
      id: 'topCanopyLobe',
      shape: 'sphere',
      position: { x: 0, y: h * 0.84, z: 0 },
      size: { width: c * 1.1, height: c * 0.9, depth: c * 1.1 },
      color: COLORS.midLeaves,
    },
  ];
  return { id: kind, parts };
}

export function treeOakParts(kind: string, heightMeters: number, footprintRadiusMeters: number): PropPartSpec[] {
  return lowerPropRecipe(treeOakRecipe(kind, heightMeters, footprintRadiusMeters));
}
