import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';

const COLORS = {
  orange: recipeColor('#e8682a'),
  band: recipeColor('#f2efe8'),
} satisfies Record<string, Color>;

export function trafficConeRecipe(heightMeters: number, footprintRadiusMeters: number): PropRecipe {
  const h = heightMeters;
  const r = footprintRadiusMeters;
  const parts: PropRecipePart[] = [
    {
      id: 'base',
      shape: 'box',
      position: { x: 0, y: h * 0.03, z: 0 },
      size: { width: r * 2, height: h * 0.06, depth: r * 2 },
      color: COLORS.orange,
    },
    {
      id: 'lowerCone',
      shape: 'cylinder8',
      position: { x: 0, y: h * 0.26, z: 0 },
      radius: h * 0.185,
      height: h * 0.4,
      color: COLORS.orange,
    },
    {
      id: 'midCone',
      shape: 'cylinder8',
      position: { x: 0, y: h * 0.57, z: 0 },
      radius: h * 0.12,
      height: h * 0.34,
      color: COLORS.orange,
    },
    {
      id: 'topCone',
      shape: 'cylinder8',
      position: { x: 0, y: h * 0.83, z: 0 },
      radius: h * 0.064,
      height: h * 0.26,
      color: COLORS.orange,
    },
    {
      id: 'reflectiveBand',
      shape: 'cylinder8',
      position: { x: 0, y: h * 0.52, z: 0 },
      radius: h * 0.15,
      height: h * 0.11,
      color: COLORS.band,
    },
  ];
  return { id: 'trafficCone', parts };
}

export function trafficConeParts(heightMeters: number, footprintRadiusMeters: number): PropPartSpec[] {
  return lowerPropRecipe(trafficConeRecipe(heightMeters, footprintRadiusMeters));
}
