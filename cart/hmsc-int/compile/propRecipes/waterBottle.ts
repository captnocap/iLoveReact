import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const waterBottleDef: PropKindDefinition = {
  kind: 'waterBottle',
  label: 'Water Bottle',
  solid: true,
  footprintRadiusMeters: 0.045,
  heightMeters: 0.22,
  tileKind: 'wall',
  trafficControl: 'none',
  dynamics: { bodyRadiusMeters: 0.045, restitution: 0.2 },
};

const COLORS = {
  plastic: recipeColor('#bcd3dd'),
  cap: recipeColor('#3a7d80'),
  label: recipeColor('#eef0f2'),
} satisfies Record<string, Color>;

export function waterBottleRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'cylinder16',
      position: { x: 0, y: 0.1, z: 0 },
      radius: 0.04,
      height: 0.18,
      color: COLORS.plastic,
    },
    {
      id: 'label',
      shape: 'cylinder16',
      position: { x: 0, y: 0.1, z: 0 },
      radius: 0.041,
      height: 0.1,
      color: COLORS.label,
    },
    {
      id: 'shoulder',
      shape: 'cylinder16',
      position: { x: 0, y: 0.2, z: 0 },
      radius: 0.025,
      height: 0.04,
      color: COLORS.plastic,
    },
    {
      id: 'cap',
      shape: 'cylinder16',
      position: { x: 0, y: 0.215, z: 0 },
      radius: 0.02,
      height: 0.03,
      color: COLORS.cap,
    },
  ];
  return { id: 'waterBottle', parts };
}

export function waterBottleParts(): PropPartSpec[] {
  return lowerPropRecipe(waterBottleRecipe());
}
