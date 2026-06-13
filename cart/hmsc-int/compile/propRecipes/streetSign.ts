import {
  lowerPropRecipe,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const streetSignDef: PropKindDefinition = {
  kind: 'streetSign',
  label: 'Street Sign',
  solid: true,
  footprintRadiusMeters: 0.12,
  footprintDepthMeters: 0.24,
  // Tall enough that the panel clears head height (visual head-top ~2.04m,
  // stylized-tall — see the R4 scale contract).
  heightMeters: 3.3,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  base: [0.42, 0.45, 0.48],
  pole: [0.6, 0.63, 0.67],
  signFace: [0.08, 0.42, 0.26],
} satisfies Record<string, Color>;

export function streetSignRecipe(heightMeters: number): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'base',
      shape: 'cylinder8',
      position: { x: 0, y: 0.06, z: 0 },
      radius: 0.14,
      height: 0.12,
      color: COLORS.base,
    },
    {
      id: 'pole',
      shape: 'cylinder8',
      position: { x: 0, y: heightMeters / 2, z: 0 },
      radius: 0.05,
      height: heightMeters,
      color: COLORS.pole,
    },
    {
      id: 'signFace',
      shape: 'box',
      position: { x: 0, y: heightMeters - 0.32, z: -0.04 },
      size: { width: 1.5, height: 0.44, depth: 0.03 },
      color: COLORS.signFace,
    },
  ];
  return { id: 'streetSign', parts };
}

export function streetSignParts(heightMeters: number): PropPartSpec[] {
  return lowerPropRecipe(streetSignRecipe(heightMeters));
}
