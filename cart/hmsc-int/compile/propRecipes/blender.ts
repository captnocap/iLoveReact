import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const blenderDef: PropKindDefinition = {
  kind: 'blender',
  label: 'Blender',
  solid: true,
  footprintRadiusMeters: 0.15,
  heightMeters: 0.4,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
  coverClass: 'none',
};

const COLORS = {
  base: recipeColor('#d6d9dc'),
  glass: recipeColor('#bcd3dd'),
  lid: recipeColor('#6b4a2e'),
} satisfies Record<string, Color>;

export function blenderRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'base', shape: 'box', position: { x: 0, y: 0.08, z: 0 }, size: { width: 0.18, height: 0.16, depth: 0.18 }, color: COLORS.base },
    { id: 'jar', shape: 'cylinder8', position: { x: 0, y: 0.28, z: 0 }, radius: 0.12, height: 0.26, color: COLORS.glass, opacity: 0.4 },
    { id: 'lid', shape: 'box', position: { x: 0, y: 0.42, z: 0 }, size: { width: 0.14, height: 0.03, depth: 0.14 }, color: COLORS.lid },
    { id: 'knob', shape: 'box', position: { x: 0, y: 0.12, z: -0.1 }, size: { width: 0.04, height: 0.04, depth: 0.03 }, color: COLORS.lid },
  ];
  return { id: 'blender', parts };
}

export function blenderParts(): PropPartSpec[] {
  return lowerPropRecipe(blenderRecipe());
}
