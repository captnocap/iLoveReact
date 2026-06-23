import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const towelRackDef: PropKindDefinition = {
  kind: 'towelRack',
  label: 'Towel Rack',
  solid: true,
  footprintRadiusMeters: 0.35,
  heightMeters: 0.22,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'none',
};

const COLORS = {
  chrome: recipeColor('#aab0b6'),
  towel: recipeColor('#e8e4d9'),
} satisfies Record<string, Color>;

export function towelRackRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'bar',
      shape: 'cylinder8',
      position: { x: 0, y: 0.16, z: 0.08 },
      radius: 0.02,
      height: 0.64,
      color: COLORS.chrome,
      rotation: { pitch: 0, yaw: 0, roll: 90 },
    },
    {
      id: 'leftBracket',
      shape: 'box',
      position: { x: -0.28, y: 0.14, z: 0.02 },
      size: { width: 0.04, height: 0.12, depth: 0.08 },
      color: COLORS.chrome,
    },
    {
      id: 'rightBracket',
      shape: 'box',
      position: { x: 0.28, y: 0.14, z: 0.02 },
      size: { width: 0.04, height: 0.12, depth: 0.08 },
      color: COLORS.chrome,
    },
    {
      id: 'hangingTowel',
      shape: 'box',
      position: { x: 0, y: 0.08, z: 0.1 },
      size: { width: 0.38, height: 0.16, depth: 0.04 },
      color: COLORS.towel,
      rotation: { pitch: -4, yaw: 0, roll: 0 },
    },
  ];
  return { id: 'towelRack', parts };
}

export function towelRackParts(): PropPartSpec[] {
  return lowerPropRecipe(towelRackRecipe());
}
