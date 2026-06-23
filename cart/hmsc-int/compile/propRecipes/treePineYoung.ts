import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const treePineYoungDef: PropKindDefinition = {
  kind: 'treePineYoung',
  label: 'Young Pine',
  solid: true,
  footprintRadiusMeters: 0.24,
  heightMeters: 11,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  bark: recipeColor('#6b4a2e'),
  wood: recipeColor('#8a6240'),
  leaf: recipeColor('#3f7d33'),
  leafLight: recipeColor('#5a9a42'),
} satisfies Record<string, Color>;

export function treePineYoungRecipe(): PropRecipe {
  const h = 11;
  const r = 0.24;
  const canopy = 1.2;
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
      position: { x: 0, y: h * 0.55, z: 0 },
      size: { width: canopy, height: h * 0.35, depth: canopy },
      color: COLORS.leaf,
    },
    {
      id: 'canopy2',
      shape: 'sphere',
      position: { x: 0, y: h * 0.72, z: 0 },
      size: { width: canopy * 0.75, height: h * 0.28, depth: canopy * 0.75 },
      color: COLORS.leafLight,
    },
    {
      id: 'canopy3',
      shape: 'sphere',
      position: { x: 0, y: h * 0.88, z: 0 },
      size: { width: canopy * 0.45, height: h * 0.2, depth: canopy * 0.45 },
      color: COLORS.leaf,
    },
  ];
  return { id: 'treePineYoung', parts };
}

export function treePineYoungParts(): PropPartSpec[] {
  return lowerPropRecipe(treePineYoungRecipe());
}
