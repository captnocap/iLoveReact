import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const bushDef: PropKindDefinition = {
  kind: 'bush',
  label: 'Bush',
  solid: false,
  footprintRadiusMeters: 1.2,
  heightMeters: 2.5,
  tileKind: 'bush',
  trafficControl: 'none',
};

const COLORS = {
  mid: recipeColor('#3f7d33'),
  light: recipeColor('#5a9a42'),
  dark: recipeColor('#2f5f26'),
} satisfies Record<string, Color>;

export function bushRecipe(heightMeters: number, footprintRadiusMeters: number): PropRecipe {
  const h = heightMeters;
  const r = footprintRadiusMeters;
  const parts: PropRecipePart[] = [
    {
      id: 'mass1',
      shape: 'sphere',
      position: { x: 0, y: h * 0.45, z: 0 },
      size: { width: r * 1.4, height: h * 0.85, depth: r * 1.3 },
      color: COLORS.mid,
    },
    {
      id: 'mass2',
      shape: 'sphere',
      position: { x: r * 0.25, y: h * 0.55, z: r * 0.1 },
      size: { width: r * 0.9, height: h * 0.6, depth: r * 0.8 },
      color: COLORS.light,
    },
    {
      id: 'mass3',
      shape: 'sphere',
      position: { x: -r * 0.2, y: h * 0.35, z: -r * 0.15 },
      size: { width: r * 0.8, height: h * 0.55, depth: r * 0.75 },
      color: COLORS.dark,
    },
    {
      id: 'mass4',
      shape: 'sphere',
      position: { x: 0, y: h * 0.75, z: r * 0.15 },
      size: { width: r * 0.6, height: h * 0.45, depth: r * 0.6 },
      color: COLORS.light,
    },
  ];
  return { id: 'bush', parts };
}

export function bushParts(heightMeters: number, footprintRadiusMeters: number): PropPartSpec[] {
  return lowerPropRecipe(bushRecipe(heightMeters, footprintRadiusMeters));
}
