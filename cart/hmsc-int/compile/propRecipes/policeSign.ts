import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const policeSignDef: PropKindDefinition = {
  kind: 'policeSign',
  label: 'Police Sign',
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
  panel: recipeColor('#2c4a66'),
  star: recipeColor('#e8b84a'),
} satisfies Record<string, Color>;

export function policeSignRecipe(): PropRecipe {
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
      id: 'starCenter',
      shape: 'box',
      position: { x: 0, y: h * 0.78, z: -0.03 },
      size: { width: 0.2, height: 0.2, depth: 0.03 },
      color: COLORS.star,
    },
    {
      id: 'starTop',
      shape: 'box',
      position: { x: 0, y: h * 0.78 + 0.15, z: -0.03 },
      size: { width: 0.08, height: 0.15, depth: 0.03 },
      color: COLORS.star,
    },
    {
      id: 'starBottom',
      shape: 'box',
      position: { x: 0, y: h * 0.78 - 0.15, z: -0.03 },
      size: { width: 0.08, height: 0.15, depth: 0.03 },
      color: COLORS.star,
    },
    {
      id: 'starLeft',
      shape: 'box',
      position: { x: -0.15, y: h * 0.78, z: -0.03 },
      size: { width: 0.15, height: 0.08, depth: 0.03 },
      color: COLORS.star,
    },
    {
      id: 'starRight',
      shape: 'box',
      position: { x: 0.15, y: h * 0.78, z: -0.03 },
      size: { width: 0.15, height: 0.08, depth: 0.03 },
      color: COLORS.star,
    },
  ];
  return { id: 'policeSign', parts };
}

export function policeSignParts(): PropPartSpec[] {
  return lowerPropRecipe(policeSignRecipe());
}
