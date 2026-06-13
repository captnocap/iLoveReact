import {
  lowerPropRecipe,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';

const COLORS = {
  body: [0.45, 0.46, 0.48],
  highlight: [0.56, 0.56, 0.58],
} satisfies Record<string, Color>;

export function rockRecipe(kind: string, heightMeters: number, footprintRadiusMeters: number): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'mainMass',
      shape: 'sphere',
      position: { x: 0, y: heightMeters * 0.45, z: 0 },
      size: { width: footprintRadiusMeters * 1.8, height: heightMeters * 0.9, depth: footprintRadiusMeters * 1.55 },
      color: COLORS.body,
    },
    {
      id: 'raisedFacet',
      shape: 'sphere',
      position: { x: footprintRadiusMeters * 0.25, y: heightMeters * 0.58, z: -footprintRadiusMeters * 0.1 },
      size: { width: footprintRadiusMeters, height: heightMeters * 0.7, depth: footprintRadiusMeters * 0.85 },
      color: COLORS.highlight,
    },
  ];
  return { id: kind, parts };
}

export function rockParts(kind: string, heightMeters: number, footprintRadiusMeters: number): PropPartSpec[] {
  return lowerPropRecipe(rockRecipe(kind, heightMeters, footprintRadiusMeters));
}
