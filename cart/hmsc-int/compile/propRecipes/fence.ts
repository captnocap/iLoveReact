import {
  lowerPropRecipe,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';

const COLORS = {
  post: [0.42, 0.45, 0.5],
  cap: [0.33, 0.36, 0.41],
  rail: [0.61, 0.64, 0.69],
  chainlink: [0.69, 0.72, 0.77],
} satisfies Record<string, Color>;

export function fenceRecipe(heightMeters: number, footprintRadiusMeters: number): PropRecipe {
  const s = heightMeters / 1.2;
  const halfSpan = footprintRadiusMeters * 0.95;
  const parts: PropRecipePart[] = [
    {
      id: 'leftPost',
      shape: 'cylinder8',
      position: { x: -halfSpan, y: heightMeters / 2, z: 0 },
      radius: 0.05 * s,
      height: heightMeters,
      color: COLORS.post,
    },
    {
      id: 'leftPostCap',
      shape: 'sphere',
      position: { x: -halfSpan, y: heightMeters + 0.015 * s, z: 0 },
      size: { width: 0.13 * s, height: 0.13 * s, depth: 0.13 * s },
      color: COLORS.cap,
    },
    {
      id: 'rightPost',
      shape: 'cylinder8',
      position: { x: halfSpan, y: heightMeters / 2, z: 0 },
      radius: 0.05 * s,
      height: heightMeters,
      color: COLORS.post,
    },
    {
      id: 'rightPostCap',
      shape: 'sphere',
      position: { x: halfSpan, y: heightMeters + 0.015 * s, z: 0 },
      size: { width: 0.13 * s, height: 0.13 * s, depth: 0.13 * s },
      color: COLORS.cap,
    },
    {
      id: 'topRail',
      shape: 'cylinder8',
      position: { x: 0, y: heightMeters - 0.04 * s, z: 0 },
      radius: 0.025 * s,
      height: halfSpan * 2,
      color: COLORS.rail,
      rotation: { pitch: 0, yaw: 0, roll: 90 },
    },
    {
      id: 'bottomRail',
      shape: 'cylinder8',
      position: { x: 0, y: 0.06 * s, z: 0 },
      radius: 0.025 * s,
      height: halfSpan * 2,
      color: COLORS.rail,
      rotation: { pitch: 0, yaw: 0, roll: 90 },
    },
    {
      id: 'chainlinkPanel',
      shape: 'box',
      position: { x: 0, y: (heightMeters - 0.14 * s) / 2 + 0.06 * s, z: 0 },
      size: { width: halfSpan * 2, height: heightMeters - 0.14 * s, depth: 0.02 * s },
      color: COLORS.chainlink,
    },
  ];
  return { id: 'fence', parts };
}

export function fenceParts(heightMeters: number, footprintRadiusMeters: number): PropPartSpec[] {
  return lowerPropRecipe(fenceRecipe(heightMeters, footprintRadiusMeters));
}
