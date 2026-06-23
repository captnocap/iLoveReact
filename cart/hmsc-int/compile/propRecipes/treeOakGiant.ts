import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const treeOakGiantDef: PropKindDefinition = {
  kind: 'treeOakGiant',
  label: 'Giant Oak',
  solid: true,
  footprintRadiusMeters: 0.8,
  heightMeters: 25,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  bark: recipeColor('#6b4a2e'),
  wood: recipeColor('#8a6240'),
  leaf: recipeColor('#3f7d33'),
  leafLight: recipeColor('#5a9a42'),
} satisfies Record<string, Color>;

export function treeOakGiantRecipe(): PropRecipe {
  const h = 25;
  const r = 0.8;
  const canopy = 3.5;
  const parts: PropRecipePart[] = [
    {
      id: 'trunk',
      shape: 'cylinder16',
      position: { x: 0, y: h * 0.25, z: 0 },
      radius: r * 0.35,
      height: h * 0.5,
      color: COLORS.bark,
    },
    {
      id: 'trunkTop',
      shape: 'cylinder16',
      position: { x: 0, y: h * 0.65, z: 0 },
      radius: r * 0.2,
      height: h * 0.3,
      color: COLORS.wood,
    },
    {
      id: 'canopy1',
      shape: 'sphere',
      position: { x: canopy * 0.2, y: h * 0.7, z: canopy * 0.1 },
      size: { width: canopy, height: h * 0.4, depth: canopy * 0.9 },
      color: COLORS.leaf,
    },
    {
      id: 'canopy2',
      shape: 'sphere',
      position: { x: -canopy * 0.15, y: h * 0.6, z: -canopy * 0.1 },
      size: { width: canopy * 0.85, height: h * 0.35, depth: canopy },
      color: COLORS.leafLight,
    },
    {
      id: 'canopy3',
      shape: 'sphere',
      position: { x: 0, y: h * 0.85, z: canopy * 0.1 },
      size: { width: canopy * 0.6, height: h * 0.25, depth: canopy * 0.6 },
      color: COLORS.leaf,
    },
  ];
  return { id: 'treeOakGiant', parts };
}

export function treeOakGiantParts(): PropPartSpec[] {
  return lowerPropRecipe(treeOakGiantRecipe());
}
