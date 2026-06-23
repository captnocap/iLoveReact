import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const spiceRackDef: PropKindDefinition = {
  kind: 'spiceRack',
  label: 'Spice Rack',
  solid: true,
  footprintRadiusMeters: 0.18,
  heightMeters: 0.35,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'none',
};

const COLORS = {
  body: recipeColor('#6b4a2e'),
  accent: recipeColor('#503722'),
  detail: recipeColor('#805837'),
} satisfies Record<string, Color>;

export function spiceRackRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'base', shape: 'box', position: { x: 0, y: 0.158, z: 0 }, size: { width: 0.252, height: 0.245, depth: 0.180 }, color: COLORS.body },
    { id: 'accent', shape: 'box', position: { x: 0, y: 0.280, z: 0 }, size: { width: 0.180, height: 0.052, depth: 0.144 }, color: COLORS.accent },
    { id: 'detail', shape: 'cylinder8', position: { x: 0.090, y: 0.175, z: 0 }, radius: 0.022, height: 0.140, color: COLORS.detail },
  ];
  return { id: 'spiceRack', parts };
}

export function spiceRackParts(): PropPartSpec[] {
  return lowerPropRecipe(spiceRackRecipe());
}
