import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const hospitalSignDef: PropKindDefinition = {
  kind: 'hospitalSign',
  label: 'Hospital Sign',
  solid: true,
  footprintRadiusMeters: 0.12,
  heightMeters: 3.2,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'none',
};

const COLORS = {
  pole: recipeColor('#9aa1ab'),
  panel: recipeColor('#eef0f2'),
  cross: recipeColor('#c2362f'),
} satisfies Record<string, Color>;

export function hospitalSignRecipe(): PropRecipe {
  const h = 3.2;
  const parts: PropRecipePart[] = [
    {
      id: 'pole',
      shape: 'box',
      position: { x: 0, y: h * 0.5, z: 0.06 },
      size: { width: 0.08, height: h, depth: 0.08 },
      color: COLORS.pole,
    },
    {
      id: 'panel',
      shape: 'box',
      position: { x: 0, y: h * 0.78, z: 0 },
      size: { width: 0.8, height: 0.8, depth: 0.06 },
      color: COLORS.panel,
    },
    {
      id: 'crossV',
      shape: 'box',
      position: { x: 0, y: h * 0.78, z: -0.03 },
      size: { width: 0.18, height: 0.5, depth: 0.03 },
      color: COLORS.cross,
    },
    {
      id: 'crossH',
      shape: 'box',
      position: { x: 0, y: h * 0.78, z: -0.03 },
      size: { width: 0.5, height: 0.18, depth: 0.03 },
      color: COLORS.cross,
    },
  ];
  return { id: 'hospitalSign', parts };
}

export function hospitalSignParts(): PropPartSpec[] {
  return lowerPropRecipe(hospitalSignRecipe());
}
