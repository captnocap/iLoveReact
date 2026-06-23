import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const monitorDef: PropKindDefinition = {
  kind: 'monitor',
  label: 'Monitor',
  solid: true,
  footprintRadiusMeters: 0.35,
  heightMeters: 0.5,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
  coverClass: 'none',
};

const COLORS = {
  shell: recipeColor('#22262b'),
  screen: recipeColor('#2c4a66'),
  stand: recipeColor('#4a4a4a'),
} satisfies Record<string, Color>;

export function monitorRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'panel', shape: 'box', position: { x: 0, y: 0.35, z: 0 }, size: { width: 0.7, height: 0.42, depth: 0.04 }, color: COLORS.shell },
    { id: 'display', shape: 'box', position: { x: 0, y: 0.35, z: -0.023 }, size: { width: 0.64, height: 0.36, depth: 0.01 }, color: COLORS.screen },
    { id: 'neck', shape: 'box', position: { x: 0, y: 0.12, z: 0.02 }, size: { width: 0.1, height: 0.12, depth: 0.08 }, color: COLORS.stand },
    { id: 'base', shape: 'box', position: { x: 0, y: 0.04, z: 0.04 }, size: { width: 0.3, height: 0.04, depth: 0.24 }, color: COLORS.stand },
  ];
  return { id: 'monitor', parts };
}

export function monitorParts(): PropPartSpec[] {
  return lowerPropRecipe(monitorRecipe());
}
