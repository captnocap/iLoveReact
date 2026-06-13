import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const ledLightDef: PropKindDefinition = {
  kind: 'ledLight',
  label: 'LED Light',
  solid: true,
  footprintRadiusMeters: 0.06,
  footprintDepthMeters: 0.12,
  heightMeters: 2.4,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'none',
};

const COLORS = {
  mount: recipeColor('#2a2d33'),
  tube: recipeColor('#5ff2ff'),
} satisfies Record<string, Color>;

export function ledLightRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'topMount',
      shape: 'box',
      position: { x: 0, y: 2.3, z: -0.03 },
      size: { width: 0.1, height: 0.06, depth: 0.06 },
      color: COLORS.mount,
    },
    {
      id: 'bottomMount',
      shape: 'box',
      position: { x: 0, y: 0.9, z: -0.03 },
      size: { width: 0.1, height: 0.06, depth: 0.06 },
      color: COLORS.mount,
    },
    {
      id: 'glowingTube',
      shape: 'cylinder8',
      position: { x: 0, y: 1.6, z: -0.07 },
      radius: 0.045,
      height: 1.4,
      color: COLORS.tube,
    },
  ];
  return { id: 'ledLight', parts };
}

export function ledLightParts(): PropPartSpec[] {
  return lowerPropRecipe(ledLightRecipe());
}
