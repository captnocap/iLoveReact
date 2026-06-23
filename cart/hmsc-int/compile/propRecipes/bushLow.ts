import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const bushLowDef: PropKindDefinition = {
  kind: 'bushLow',
  label: 'Low Hedge',
  solid: false,
  footprintRadiusMeters: 0.85,
  heightMeters: 0.9,
  tileKind: 'bush',
  trafficControl: 'none',
  coverClass: 'none',
};

const COLORS = {
  mid: recipeColor('#3f7d33'),
  light: recipeColor('#5a9a42'),
  dark: recipeColor('#2f5f26'),
} satisfies Record<string, Color>;

export function bushLowRecipe(): PropRecipe {
  const h = 0.9;
  const r = 0.85;
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
  ];
  return { id: 'bushLow', parts };
}

export function bushLowParts(): PropPartSpec[] {
  return lowerPropRecipe(bushLowRecipe());
}
