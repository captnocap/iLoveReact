import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const workbenchDef: PropKindDefinition = {
  kind: 'workbench',
  label: 'Workbench',
  solid: true,
  footprintRadiusMeters: 0.9,
  heightMeters: 0.92,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  top: recipeColor('#6b4a2e'),
  leg: recipeColor('#3a3f46'),
  drawer: recipeColor('#9aa1ab'),
} satisfies Record<string, Color>;

export function workbenchRecipe(): PropRecipe {
  const h = 0.92;
  const w = 1.6;
  const d = 0.7;
  const parts: PropRecipePart[] = [
    {
      id: 'top',
      shape: 'box',
      position: { x: 0, y: h - 0.02, z: 0 },
      size: { width: w, height: 0.05, depth: d },
      color: COLORS.top,
    },
    {
      id: 'drawer',
      shape: 'box',
      position: { x: 0, y: h * 0.6, z: d * 0.45 },
      size: { width: w * 0.9, height: h * 0.25, depth: 0.04 },
      color: COLORS.drawer,
    },
    {
      id: 'legFL',
      shape: 'box',
      position: { x: -w * 0.45, y: h * 0.35, z: d * 0.4 },
      size: { width: 0.06, height: h * 0.7, depth: 0.06 },
      color: COLORS.leg,
    },
    {
      id: 'legFR',
      shape: 'box',
      position: { x: w * 0.45, y: h * 0.35, z: d * 0.4 },
      size: { width: 0.06, height: h * 0.7, depth: 0.06 },
      color: COLORS.leg,
    },
    {
      id: 'legBL',
      shape: 'box',
      position: { x: -w * 0.45, y: h * 0.35, z: -d * 0.4 },
      size: { width: 0.06, height: h * 0.7, depth: 0.06 },
      color: COLORS.leg,
    },
    {
      id: 'legBR',
      shape: 'box',
      position: { x: w * 0.45, y: h * 0.35, z: -d * 0.4 },
      size: { width: 0.06, height: h * 0.7, depth: 0.06 },
      color: COLORS.leg,
    },
  ];
  return { id: 'workbench', parts };
}

export function workbenchParts(): PropPartSpec[] {
  return lowerPropRecipe(workbenchRecipe());
}
