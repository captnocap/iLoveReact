import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';

const COLORS = {
  bark: recipeColor('#5c4631'),
  barkDark: recipeColor('#4a3826'),
  frond: recipeColor('#3a7d36'),
  crown: recipeColor('#26512e'),
} satisfies Record<string, Color>;

export function treePalmRecipe(heightMeters: number, footprintRadiusMeters: number): PropRecipe {
  const h = heightMeters;
  const r = footprintRadiusMeters;
  const lean = h * 0.18;
  const segH = (h * 0.92) / 4;
  const parts: PropRecipePart[] = [];

  for (let i = 0; i < 4; i += 1) {
    const t = i / 4;
    parts.push({
      id: `trunkSegment${i + 1}`,
      shape: 'cylinder8',
      position: { x: lean * (t + 0.125), y: segH * (i + 0.5), z: 0 },
      radius: r * (1 - t * 0.35),
      height: segH * 1.1,
      color: i % 2 === 0 ? COLORS.bark : COLORS.barkDark,
    });
  }

  const frondLength = h * 0.34;
  for (let i = 0; i < 7; i += 1) {
    const a = (i / 7) * 360;
    const rad = a * Math.PI / 180;
    const reach = frondLength * 0.55;
    parts.push({
      id: `frond${i + 1}`,
      shape: 'sphere',
      position: { x: lean + Math.cos(rad) * reach, y: h * 0.9, z: Math.sin(rad) * reach },
      size: { width: frondLength * 2, height: h * 0.05, depth: frondLength * 0.44 },
      color: COLORS.frond,
      rotation: { pitch: 0, yaw: -a, roll: 0 },
    });
  }

  parts.push({
    id: 'crown',
    shape: 'sphere',
    position: { x: lean, y: h * 0.92, z: 0 },
    size: { width: h * 0.12, height: h * 0.1, depth: h * 0.12 },
    color: COLORS.crown,
  });
  parts.push({
    id: 'frontCoconut',
    shape: 'sphere',
    position: { x: lean + h * 0.035, y: h * 0.885, z: h * 0.02 },
    size: { width: h * 0.056, height: h * 0.056, depth: h * 0.056 },
    color: COLORS.barkDark,
  });
  parts.push({
    id: 'rearCoconut',
    shape: 'sphere',
    position: { x: lean - h * 0.03, y: h * 0.885, z: -h * 0.025 },
    size: { width: h * 0.056, height: h * 0.056, depth: h * 0.056 },
    color: COLORS.barkDark,
  });

  return { id: 'treePalm', parts };
}

export function treePalmParts(heightMeters: number, footprintRadiusMeters: number): PropPartSpec[] {
  return lowerPropRecipe(treePalmRecipe(heightMeters, footprintRadiusMeters));
}
