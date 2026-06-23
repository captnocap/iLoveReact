import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const bushSparseDef: PropKindDefinition = {
  kind: 'bushSparse',
  label: 'Sparse Bush',
  solid: false,
  footprintRadiusMeters: 0.7,
  heightMeters: 1.1,
  tileKind: 'bush',
  trafficControl: 'none',
};

const COLORS = {
  mid: recipeColor('#3f7d33'),
  light: recipeColor('#5a9a42'),
  dark: recipeColor('#2f5f26'),
} satisfies Record<string, Color>;

export function bushSparseRecipe(): PropRecipe {
  const h = 1.1;
  const r = 0.7;
  const parts: PropRecipePart[] = [
    {
      id: 'mass1',
      shape: 'sphere',
      position: { x: 0, y: h * 0.45, z: 0 },
      size: { width: r * 1.2, height: h * 0.75, depth: r * 1.1 },
      color: COLORS.mid,
    },
    {
      id: 'mass2',
      shape: 'sphere',
      position: { x: r * 0.3, y: h * 0.6, z: r * 0.1 },
      size: { width: r * 0.6, height: h * 0.45, depth: r * 0.55 },
      color: COLORS.light,
    },
    {
      id: 'mass3',
      shape: 'sphere',
      position: { x: -r * 0.2, y: h * 0.4, z: -r * 0.15 },
      size: { width: r * 0.55, height: h * 0.45, depth: r * 0.5 },
      color: COLORS.dark,
    },
    {
      id: 'branch',
      shape: 'box',
      position: { x: 0, y: h * 0.35, z: 0 },
      size: { width: r * 0.15, height: h * 0.7, depth: r * 0.15 },
      color: COLORS.dark,
      rotation: { pitch: 5, yaw: 0, roll: 3 },
    },
  ];
  return { id: 'bushSparse', parts };
}

export function bushSparseParts(): PropPartSpec[] {
  return lowerPropRecipe(bushSparseRecipe());
}
