import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const beanBagDef: PropKindDefinition = {
  kind: 'beanBag',
  label: 'Bean Bag',
  solid: true,
  footprintRadiusMeters: 0.45,
  heightMeters: 0.65,
  tileKind: 'wall',
  trafficControl: 'none',
  seat: { pose: 'sit', seatHeightMeters: 0.32, capacity: 1 },
  coverClass: 'soft',
};

const COLORS = {
  fabric: recipeColor('#7d3b4a'),
  fabricDark: recipeColor('#5c3328'),
} satisfies Record<string, Color>;

export function beanBagRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'base',
      shape: 'sphere',
      position: { x: 0, y: 0.28, z: 0 },
      size: { width: 0.8, height: 0.55, depth: 0.8 },
      color: COLORS.fabric,
    },
    {
      id: 'top',
      shape: 'sphere',
      position: { x: 0, y: 0.45, z: -0.1 },
      size: { width: 0.6, height: 0.35, depth: 0.55 },
      color: COLORS.fabricDark,
    },
    {
      id: 'seam',
      shape: 'cylinder8',
      position: { x: 0, y: 0.25, z: 0 },
      radius: 0.35,
      height: 0.05,
      color: COLORS.fabricDark,
    },
  ];
  return { id: 'beanBag', parts };
}

export function beanBagParts(): PropPartSpec[] {
  return lowerPropRecipe(beanBagRecipe());
}
