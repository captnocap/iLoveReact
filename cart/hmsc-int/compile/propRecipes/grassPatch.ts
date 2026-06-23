import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const grassPatchDef: PropKindDefinition = {
  kind: 'grassPatch',
  label: 'Grass Patch',
  solid: false,
  footprintRadiusMeters: 0.7,
  heightMeters: 0.3,
  tileKind: 'bush',
  trafficControl: 'none',
  coverClass: 'none',
};

const COLORS = {
  mid: recipeColor('#5a9a42'),
  light: recipeColor('#8a9a4a'),
  dark: recipeColor('#3f7d33'),
} satisfies Record<string, Color>;

export function grassPatchRecipe(): PropRecipe {
  const h = 0.3;
  const r = 0.7;
  const parts: PropRecipePart[] = [
    {
      id: 'tuft1',
      shape: 'box',
      position: { x: r * 0.2, y: h * 0.5, z: r * 0.1 },
      size: { width: r * 0.12, height: h * 0.9, depth: r * 0.08 },
      color: COLORS.mid,
      rotation: { pitch: 5, yaw: 0, roll: 8 },
    },
    {
      id: 'tuft2',
      shape: 'box',
      position: { x: -r * 0.15, y: h * 0.45, z: r * 0.2 },
      size: { width: r * 0.1, height: h * 0.8, depth: r * 0.07 },
      color: COLORS.light,
      rotation: { pitch: -7, yaw: 0, roll: -5 },
    },
    {
      id: 'tuft3',
      shape: 'box',
      position: { x: r * 0.05, y: h * 0.55, z: -r * 0.2 },
      size: { width: r * 0.11, height: h * 0.95, depth: r * 0.09 },
      color: COLORS.dark,
      rotation: { pitch: 6, yaw: 0, roll: 12 },
    },
    {
      id: 'tuft4',
      shape: 'box',
      position: { x: -r * 0.25, y: h * 0.4, z: -r * 0.05 },
      size: { width: r * 0.09, height: h * 0.75, depth: r * 0.08 },
      color: COLORS.mid,
      rotation: { pitch: -4, yaw: 0, roll: -10 },
    },
  ];
  return { id: 'grassPatch', parts };
}

export function grassPatchParts(): PropPartSpec[] {
  return lowerPropRecipe(grassPatchRecipe());
}
