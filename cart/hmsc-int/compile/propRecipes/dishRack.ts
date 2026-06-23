import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const dishRackDef: PropKindDefinition = {
  kind: 'dishRack',
  label: 'Dish Rack',
  solid: true,
  footprintRadiusMeters: 0.25,
  heightMeters: 0.25,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'none',
};

const COLORS = {
  body: recipeColor('#eef0f2'),
  accent: recipeColor('#b2b3b5'),
  detail: recipeColor('#ffffff'),
} satisfies Record<string, Color>;

export function dishRackRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'base', shape: 'box', position: { x: 0, y: 0.113, z: 0 }, size: { width: 0.350, height: 0.175, depth: 0.250 }, color: COLORS.body },
    { id: 'accent', shape: 'box', position: { x: 0, y: 0.200, z: 0 }, size: { width: 0.250, height: 0.037, depth: 0.200 }, color: COLORS.accent },
    { id: 'detail', shape: 'cylinder8', position: { x: 0.125, y: 0.125, z: 0 }, radius: 0.030, height: 0.100, color: COLORS.detail },
  ];
  return { id: 'dishRack', parts };
}

export function dishRackParts(): PropPartSpec[] {
  return lowerPropRecipe(dishRackRecipe());
}
