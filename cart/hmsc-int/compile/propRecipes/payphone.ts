import {
  lowerPropRecipe,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';

const COLORS = {
  post: [0.6, 0.62, 0.64],
  body: [0.84, 0.86, 0.88],
  hood: [0.18, 0.43, 0.69],
  glass: [0.13, 0.31, 0.5],
  phonePanel: [0.12, 0.14, 0.17],
  handset: [0.09, 0.1, 0.11],
} satisfies Record<string, Color>;

export function payphoneRecipe(heightMeters: number): PropRecipe {
  // PROPSCALE-0611: 1.54 = the hood's real top (1.46 + 0.08), was 1.45.
  const s = heightMeters / 1.54;
  const parts: PropRecipePart[] = [
    {
      id: 'post',
      shape: 'cylinder8',
      position: { x: 0, y: 0.5 * s, z: 0 },
      radius: 0.05 * s,
      height: 1.0 * s,
      color: COLORS.post,
    },
    {
      id: 'phoneBody',
      shape: 'box',
      position: { x: 0, y: 1.12 * s, z: 0 },
      size: { width: 0.42 * s, height: 0.6 * s, depth: 0.22 * s },
      color: COLORS.body,
    },
    {
      id: 'blueHood',
      shape: 'box',
      position: { x: 0, y: 1.46 * s, z: -0.04 * s },
      size: { width: 0.5 * s, height: 0.16 * s, depth: 0.34 * s },
      color: COLORS.hood,
    },
    {
      id: 'glassPanel',
      shape: 'box',
      position: { x: 0, y: 1.3 * s, z: 0.1 * s },
      size: { width: 0.5 * s, height: 0.34 * s, depth: 0.06 * s },
      color: COLORS.glass,
    },
    {
      id: 'phonePanel',
      shape: 'box',
      position: { x: 0, y: 1.14 * s, z: -0.12 * s },
      size: { width: 0.3 * s, height: 0.42 * s, depth: 0.04 * s },
      color: COLORS.phonePanel,
    },
    {
      id: 'handset',
      shape: 'box',
      position: { x: -0.24 * s, y: 1.12 * s, z: -0.06 * s },
      size: { width: 0.08 * s, height: 0.34 * s, depth: 0.08 * s },
      color: COLORS.handset,
    },
  ];
  return { id: 'payphone', parts };
}

export function payphoneParts(heightMeters: number): PropPartSpec[] {
  return lowerPropRecipe(payphoneRecipe(heightMeters));
}
