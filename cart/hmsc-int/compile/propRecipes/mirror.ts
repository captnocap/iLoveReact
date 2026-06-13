import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const mirrorDef: PropKindDefinition = {
  kind: 'mirror',
  label: 'Mirror',
  // Wall decor: anchor at the wall base, the glass hangs at height.
  solid: true,
  footprintRadiusMeters: 0.06,
  footprintDepthMeters: 0.12,
  heightMeters: 1.9,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'none',
};

const COLORS = {
  frame: recipeColor('#8c9299'),
  glass: recipeColor('#bcd6e2'),
  highlight: recipeColor('#e8f4fa'),
} satisfies Record<string, Color>;

export function mirrorRecipe(): PropRecipe {
  const cy = 1.18;
  const parts: PropRecipePart[] = [
    {
      id: 'frame',
      shape: 'box',
      position: { x: 0, y: cy, z: -0.025 },
      size: { width: 0.62, height: 1.5, depth: 0.04 },
      color: COLORS.frame,
    },
    {
      id: 'glass',
      shape: 'box',
      position: { x: 0, y: cy, z: -0.05 },
      size: { width: 0.54, height: 1.42, depth: 0.012 },
      color: COLORS.glass,
    },
    {
      id: 'highlight',
      shape: 'box',
      position: { x: 0.09, y: cy + 0.04, z: -0.058 },
      size: { width: 0.07, height: 1.25, depth: 0.006 },
      color: COLORS.highlight,
      rotation: { pitch: 0, yaw: 0, roll: 18 },
    },
  ];
  return { id: 'mirror', parts };
}

export function mirrorParts(): PropPartSpec[] {
  return lowerPropRecipe(mirrorRecipe());
}
