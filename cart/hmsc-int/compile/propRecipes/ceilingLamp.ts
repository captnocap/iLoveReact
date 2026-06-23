import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const ceilingLampDef: PropKindDefinition = {
  kind: 'ceilingLamp',
  label: 'Ceiling Lamp',
  solid: true,
  footprintRadiusMeters: 0.25,
  heightMeters: 2.4,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'none',
};

const COLORS = {
  shade: recipeColor('#eef0f2'),
  cord: recipeColor('#1a1c1e'),
  bulb: recipeColor('#e8b84a'),
} satisfies Record<string, Color>;

export function ceilingLampRecipe(): PropRecipe {
  const h = 2.4;
  const parts: PropRecipePart[] = [
    {
      id: 'cord',
      shape: 'cylinder8',
      position: { x: 0, y: h * 0.85, z: 0 },
      radius: 0.01,
      height: h * 0.3,
      color: COLORS.cord,
    },
    {
      id: 'shade',
      shape: 'sphere',
      position: { x: 0, y: h * 0.55, z: 0 },
      size: { width: 0.7, height: 0.35, depth: 0.7 },
      color: COLORS.shade,
    },
    {
      id: 'bulb',
      shape: 'sphere',
      position: { x: 0, y: h * 0.52, z: 0 },
      size: { width: 0.12, height: 0.12, depth: 0.12 },
      color: COLORS.bulb,
    },
  ];
  return { id: 'ceilingLamp', parts };
}

export function ceilingLampParts(): PropPartSpec[] {
  return lowerPropRecipe(ceilingLampRecipe());
}
