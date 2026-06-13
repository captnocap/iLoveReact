import {
  lowerPropRecipe,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';

const COLORS = {
  post: [0.42, 0.35, 0.26],
  barrel: [0.61, 0.64, 0.69],
  endCap: [0.47, 0.5, 0.55],
  flag: [0.76, 0.23, 0.13],
} satisfies Record<string, Color>;

export function mailboxRecipe(heightMeters: number): PropRecipe {
  // PROPSCALE-0611: 1.22 = the barrel's real top (1.04 + 0.18), was 1.3.
  const s = heightMeters / 1.22;
  const parts: PropRecipePart[] = [
    {
      id: 'post',
      shape: 'cylinder8',
      position: { x: 0, y: 0.475 * s, z: 0 },
      radius: 0.06 * s,
      height: 0.95 * s,
      color: COLORS.post,
    },
    {
      id: 'barrel',
      shape: 'cylinder16',
      position: { x: 0, y: 1.04 * s, z: 0 },
      radius: 0.18 * s,
      height: 0.42 * s,
      color: COLORS.barrel,
      rotation: { pitch: 90, yaw: 0, roll: 0 },
    },
    {
      id: 'frontCap',
      shape: 'cylinder16',
      position: { x: 0, y: 1.04 * s, z: 0.22 * s },
      radius: 0.18 * s,
      height: 0.03 * s,
      color: COLORS.endCap,
      rotation: { pitch: 90, yaw: 0, roll: 0 },
    },
    {
      id: 'rearCap',
      shape: 'cylinder16',
      position: { x: 0, y: 1.04 * s, z: -0.22 * s },
      radius: 0.18 * s,
      height: 0.03 * s,
      color: COLORS.endCap,
      rotation: { pitch: 90, yaw: 0, roll: 0 },
    },
    {
      id: 'flag',
      shape: 'box',
      position: { x: 0.2 * s, y: 1.08 * s, z: 0.06 * s },
      size: { width: 0.02 * s, height: 0.16 * s, depth: 0.08 * s },
      color: COLORS.flag,
    },
  ];
  return { id: 'mailbox', parts };
}

export function mailboxParts(heightMeters: number): PropPartSpec[] {
  return lowerPropRecipe(mailboxRecipe(heightMeters));
}
