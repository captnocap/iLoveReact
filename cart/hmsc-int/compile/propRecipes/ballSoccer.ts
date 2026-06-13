import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const ballSoccerDef: PropKindDefinition = {
  kind: 'ballSoccer',
  label: 'Soccer Ball',
  solid: true,
  // PROPSCALE-0611: regulation size-5 (Ø0.22m) × 1.15
  footprintRadiusMeters: 0.125,
  heightMeters: 0.25,
  tileKind: 'wall',
  trafficControl: 'none',
  dynamics: { bodyRadiusMeters: 0.125, restitution: 0.65 },
};

const COLORS = {
  shell: recipeColor('#f0f0ee'),
  patch: recipeColor('#1c1c20'),
} satisfies Record<string, Color>;

export function ballSoccerRecipe(footprintRadiusMeters: number): PropRecipe {
  const R = footprintRadiusMeters;
  const parts: PropRecipePart[] = [
    {
      id: 'shell',
      shape: 'sphere',
      position: { x: 0, y: R, z: 0 },
      size: { width: R * 2, height: R * 2, depth: R * 2 },
      color: COLORS.shell,
    },
  ];
  const spots: [string, number, number][] = [
    ['topPatch', 0, 65],
    ['rightPatch', 80, 20],
    ['rearPatch', 160, 45],
    ['leftPatch', 240, 15],
    ['frontPatch', 320, 40],
  ];
  for (const [id, azimuth, elevation] of spots) {
    const a = azimuth * Math.PI / 180;
    const e = elevation * Math.PI / 180;
    parts.push({
      id,
      shape: 'sphere',
      position: {
        x: Math.cos(e) * Math.cos(a) * R * 0.86,
        y: R + Math.sin(e) * R * 0.86,
        z: Math.cos(e) * Math.sin(a) * R * 0.86,
      },
      size: { width: R * 0.6, height: R * 0.6, depth: R * 0.6 },
      color: COLORS.patch,
    });
  }
  return { id: 'ballSoccer', parts };
}

export function ballSoccerParts(footprintRadiusMeters: number): PropPartSpec[] {
  return lowerPropRecipe(ballSoccerRecipe(footprintRadiusMeters));
}
