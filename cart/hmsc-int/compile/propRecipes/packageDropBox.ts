import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const packageDropBoxDef: PropKindDefinition = {
  kind: 'packageDropBox',
  label: 'Package Drop Box',
  solid: true,
  footprintRadiusMeters: 0.35,
  heightMeters: 1.0,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  post: recipeColor('#2c2c2e'),
  box: recipeColor('#4a4a4e'),
  door: recipeColor('#515155'),
} satisfies Record<string, Color>;

export function packageDropBoxRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'post', shape: 'box', position: { x: 0, y: 0.300, z: 0 }, size: { width: 0.06, height: 0.600, depth: 0.06 }, color: COLORS.post },
    { id: 'box', shape: 'box', position: { x: 0, y: 0.775, z: 0 }, size: { width: 0.630, height: 0.350, depth: 0.350 }, color: COLORS.box },
    { id: 'door', shape: 'box', position: { x: 0.320, y: 0.775, z: 0 }, size: { width: 0.015, height: 0.245, depth: 0.310 }, color: COLORS.door },
  ];
  return { id: 'packageDropBox', parts };
}

export function packageDropBoxParts(): PropPartSpec[] {
  return lowerPropRecipe(packageDropBoxRecipe());
}
