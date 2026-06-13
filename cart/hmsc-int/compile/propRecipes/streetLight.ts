import {
  lowerPropRecipe,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';

const COLORS = {
  base: [0.16, 0.18, 0.21],
  metal: [0.23, 0.25, 0.29],
  lampHousing: [0.29, 0.31, 0.34],
  warmGlass: [1, 0.95, 0.76],
} satisfies Record<string, Color>;

export function streetLightRecipe(heightMeters: number): PropRecipe {
  const poleHeight = heightMeters - 0.3;
  const parts: PropRecipePart[] = [
    {
      id: 'base',
      shape: 'cylinder16',
      position: { x: 0, y: 0.15, z: 0 },
      radius: 0.2,
      height: 0.3,
      color: COLORS.base,
    },
    {
      id: 'pole',
      shape: 'cylinder16',
      position: { x: 0, y: poleHeight / 2 + 0.3, z: 0 },
      radius: 0.085,
      height: poleHeight,
      color: COLORS.metal,
    },
    {
      id: 'arm',
      shape: 'cylinder8',
      position: { x: 0, y: heightMeters - 0.1, z: -0.575 },
      radius: 0.05,
      height: 1.15,
      color: COLORS.metal,
      rotation: { pitch: 90, yaw: 0, roll: 0 },
    },
    {
      id: 'lampHead',
      shape: 'box',
      position: { x: 0, y: heightMeters - 0.12, z: -1.15 },
      size: { width: 0.22, height: 0.12, depth: 0.4 },
      color: COLORS.lampHousing,
    },
    {
      id: 'lampGlass',
      shape: 'box',
      position: { x: 0, y: heightMeters - 0.19, z: -1.15 },
      size: { width: 0.16, height: 0.04, depth: 0.3 },
      color: COLORS.warmGlass,
    },
  ];
  return { id: 'streetLight', parts };
}

export function streetLightParts(heightMeters: number): PropPartSpec[] {
  return lowerPropRecipe(streetLightRecipe(heightMeters));
}
