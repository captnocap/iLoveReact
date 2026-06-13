import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';

const PALETTE: Color[] = [recipeColor('#1f4a20'), recipeColor('#2f6b2f'), recipeColor('#43883a')];

type Blob = { cx: number; cy: number; cz: number; rh: number; rv: number; tint: number };

export function bushRecipe(heightMeters: number, footprintRadiusMeters: number): PropRecipe {
  const radius = footprintRadiusMeters;
  const height = heightMeters;
  const blobs: Blob[] = [
    { cx: 0, cy: 0.18, cz: 0, rh: 0.86, rv: 0.82, tint: 1 },
    { cx: 0.4, cy: 0.1, cz: 0.04, rh: 0.62, rv: 0.52, tint: 0 },
    { cx: -0.38, cy: 0.12, cz: 0.12, rh: 0.64, rv: 0.52, tint: 2 },
    { cx: 0.08, cy: 0.08, cz: -0.42, rh: 0.6, rv: 0.5, tint: 2 },
    { cx: -0.14, cy: 0.1, cz: 0.4, rh: 0.62, rv: 0.5, tint: 0 },
    { cx: 0.12, cy: 0.62, cz: 0.08, rh: 0.4, rv: 0.36, tint: 2 },
    { cx: -0.16, cy: 0.66, cz: -0.06, rh: 0.36, rv: 0.34, tint: 0 },
  ];
  for (let i = 0; i < 9; i += 1) {
    const a = (i / 9) * Math.PI * 2;
    const rh = 0.6 + (i % 3) * 0.05;
    blobs.push({ cx: Math.cos(a) * (rh - 0.04), cz: Math.sin(a) * (rh - 0.04), cy: 0.26 + (i % 2) * 0.14, rh, rv: 0.46, tint: i % 3 });
  }
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    const rh = 0.42 + (i % 2) * 0.05;
    blobs.push({ cx: Math.cos(a) * (rh - 0.06), cz: Math.sin(a) * (rh - 0.06), cy: 0.5 + (i % 2) * 0.1, rh, rv: 0.4, tint: (i % 2) === 0 ? 2 : 0 });
  }
  const parts: PropRecipePart[] = blobs.map((blob, i) => ({
    id: `blob${i}`,
    shape: 'sphere',
    position: { x: blob.cx * radius, y: blob.cy * height, z: blob.cz * radius },
    size: { width: blob.rh * radius * 2, height: blob.rv * height * 2, depth: blob.rh * radius * 2 },
    color: PALETTE[blob.tint],
  }));
  return { id: 'bush', parts };
}

export function bushParts(heightMeters: number, footprintRadiusMeters: number): PropPartSpec[] {
  return lowerPropRecipe(bushRecipe(heightMeters, footprintRadiusMeters));
}
