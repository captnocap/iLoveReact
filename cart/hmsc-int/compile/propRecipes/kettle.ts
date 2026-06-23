import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const kettleDef: PropKindDefinition = {
  kind: 'kettle',
  label: 'Kettle',
  solid: true,
  footprintRadiusMeters: 0.12,
  heightMeters: 0.22,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'none',
};

const COLORS = {
  body: recipeColor('#9aa1ab'),
  accent: recipeColor('#737880'),
  detail: recipeColor('#b8c1cd'),
} satisfies Record<string, Color>;

export function kettleRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'base', shape: 'box', position: { x: 0, y: 0.099, z: 0 }, size: { width: 0.168, height: 0.154, depth: 0.120 }, color: COLORS.body },
    { id: 'accent', shape: 'box', position: { x: 0, y: 0.176, z: 0 }, size: { width: 0.120, height: 0.033, depth: 0.096 }, color: COLORS.accent },
    { id: 'detail', shape: 'cylinder8', position: { x: 0.060, y: 0.110, z: 0 }, radius: 0.014, height: 0.088, color: COLORS.detail },
  ];
  return { id: 'kettle', parts };
}

export function kettleParts(): PropPartSpec[] {
  return lowerPropRecipe(kettleRecipe());
}
