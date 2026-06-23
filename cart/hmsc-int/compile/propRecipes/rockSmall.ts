import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const rockSmallDef: PropKindDefinition = {
  kind: 'rockSmall',
  label: 'Small Rock',
  solid: true,
  footprintRadiusMeters: 0.28,
  heightMeters: 0.42,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  main: recipeColor('#6b7079'),
  dark: recipeColor('#52565d'),
  light: recipeColor('#82868d'),
} satisfies Record<string, Color>;

export function rockSmallRecipe(): PropRecipe {
  const h = 0.42;
  const r = 0.28;
  const parts: PropRecipePart[] = [
    {
      id: 'core',
      shape: 'box',
      position: { x: 0, y: h * 0.45, z: 0 },
      size: { width: r * 1.2, height: h * 0.8, depth: r * 1.0 },
      color: COLORS.main,
    },
    {
      id: 'facet1',
      shape: 'box',
      position: { x: r * 0.2, y: h * 0.55, z: r * 0.1 },
      size: { width: r * 0.7, height: h * 0.5, depth: r * 0.6 },
      color: COLORS.dark,
      rotation: { pitch: 12, yaw: 20, roll: 5 },
    },
    {
      id: 'facet2',
      shape: 'box',
      position: { x: -r * 0.15, y: h * 0.5, z: -r * 0.1 },
      size: { width: r * 0.6, height: h * 0.55, depth: r * 0.7 },
      color: COLORS.light,
      rotation: { pitch: -8, yaw: -15, roll: 10 },
    },
  ];
  return { id: 'rockSmall', parts };
}

export function rockSmallParts(): PropPartSpec[] {
  return lowerPropRecipe(rockSmallRecipe());
}
