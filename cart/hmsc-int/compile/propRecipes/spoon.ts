import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const spoonDef: PropKindDefinition = {
  kind: 'spoon',
  label: 'Spoon',
  solid: true,
  footprintRadiusMeters: 0.025,
  heightMeters: 0.02,
  tileKind: 'wall',
  trafficControl: 'none',
  dynamics: { bodyRadiusMeters: 0.025, restitution: 0.12 },
};

const COLORS = {
  steel: recipeColor('#9aa1ab'),
} satisfies Record<string, Color>;

export function spoonRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'handle',
      shape: 'box',
      position: { x: 0, y: 0.006, z: -0.07 },
      size: { width: 0.016, height: 0.008, depth: 0.12 },
      color: COLORS.steel,
    },
    {
      id: 'neck',
      shape: 'box',
      position: { x: 0, y: 0.006, z: 0.03 },
      size: { width: 0.018, height: 0.008, depth: 0.03 },
      color: COLORS.steel,
    },
    {
      id: 'bowl',
      shape: 'sphere',
      position: { x: 0, y: 0.008, z: 0.075 },
      size: { width: 0.04, height: 0.015, depth: 0.06 },
      color: COLORS.steel,
    },
  ];
  return { id: 'spoon', parts };
}

export function spoonParts(): PropPartSpec[] {
  return lowerPropRecipe(spoonRecipe());
}
