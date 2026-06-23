import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const mugDef: PropKindDefinition = {
  kind: 'mug',
  label: 'Mug',
  solid: true,
  footprintRadiusMeters: 0.055,
  heightMeters: 0.12,
  tileKind: 'wall',
  trafficControl: 'none',
  dynamics: { bodyRadiusMeters: 0.055, restitution: 0.22 },
};

const COLORS = {
  ceramic: recipeColor('#8a6240'),
  coffee: recipeColor('#3d2b1f'),
} satisfies Record<string, Color>;

export function mugRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'bowl',
      shape: 'cylinder16',
      position: { x: 0, y: 0.05, z: 0 },
      radius: 0.05,
      height: 0.1,
      color: COLORS.ceramic,
    },
    {
      id: 'handle',
      shape: 'cylinder8',
      position: { x: 0.06, y: 0.06, z: 0 },
      radius: 0.012,
      height: 0.05,
      color: COLORS.ceramic,
      rotation: { pitch: 0, yaw: 0, roll: 90 },
    },
    {
      id: 'liquid',
      shape: 'cylinder16',
      position: { x: 0, y: 0.09, z: 0 },
      radius: 0.042,
      height: 0.015,
      color: COLORS.coffee,
    },
  ];
  return { id: 'mug', parts };
}

export function mugParts(): PropPartSpec[] {
  return lowerPropRecipe(mugRecipe());
}
