import {
  lowerPropRecipe,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';

const COLORS = {
  base: [0.38, 0.4, 0.44],
  pole: [0.55, 0.57, 0.6],
  signBack: [0.88, 0.89, 0.87],
  signFace: [0.75, 0.14, 0.12],
} satisfies Record<string, Color>;

export function stopSignRecipe(heightMeters: number): PropRecipe {
  const signY = heightMeters - 0.5;
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
      id: 'octagonBack',
      shape: 'cylinder8',
      position: { x: 0, y: signY, z: 0.005 },
      radius: 0.45,
      height: 0.04,
      color: COLORS.signBack,
      rotation: { pitch: 90, yaw: 0, roll: 22.5 },
    },
    {
      id: 'octagonFace',
      shape: 'cylinder8',
      position: { x: 0, y: signY, z: -0.02 },
      radius: 0.4,
      height: 0.05,
      color: COLORS.signFace,
      rotation: { pitch: 90, yaw: 0, roll: 22.5 },
    },
  ];
  return { id: 'stopSign', parts };
}

export function stopSignParts(heightMeters: number): PropPartSpec[] {
  return lowerPropRecipe(stopSignRecipe(heightMeters));
}
