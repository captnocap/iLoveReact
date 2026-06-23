import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const wallSconceDef: PropKindDefinition = {
  kind: 'wallSconce',
  label: 'Wall Sconce',
  solid: true,
  footprintRadiusMeters: 0.15,
  footprintDepthMeters: 0.2,
  heightMeters: 0.35,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'none',
};

const COLORS = {
  mount: recipeColor('#6b4a2e'),
  shade: recipeColor('#8a6240'),
  bulb: recipeColor('#f2e6a8'),
} satisfies Record<string, Color>;

export function wallSconceRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'mount', shape: 'box', position: { x: 0, y: 0.18, z: 0.06 }, size: { width: 0.12, height: 0.16, depth: 0.06 }, color: COLORS.mount },
    { id: 'arm', shape: 'box', position: { x: 0, y: 0.24, z: 0.12 }, size: { width: 0.04, height: 0.04, depth: 0.14 }, color: COLORS.mount },
    { id: 'shade', shape: 'box', position: { x: 0, y: 0.18, z: 0.2 }, size: { width: 0.24, height: 0.22, depth: 0.18 }, color: COLORS.shade },
    { id: 'bulb', shape: 'box', position: { x: 0, y: 0.18, z: 0.18 }, size: { width: 0.08, height: 0.08, depth: 0.08 }, color: COLORS.bulb },
  ];
  return { id: 'wallSconce', parts };
}

export function wallSconceParts(): PropPartSpec[] {
  return lowerPropRecipe(wallSconceRecipe());
}
