import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const toasterDef: PropKindDefinition = {
  kind: 'toaster',
  label: 'Toaster',
  solid: true,
  footprintRadiusMeters: 0.25,
  heightMeters: 0.22,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
  coverClass: 'none',
};

const COLORS = {
  body: recipeColor('#d6d9dc'),
  chrome: recipeColor('#9aa1ab'),
  slot: recipeColor('#22262b'),
} satisfies Record<string, Color>;

export function toasterRecipe(): PropRecipe {
  const w = 0.5;
  const d = 0.28;
  const h = 0.22;
  const parts: PropRecipePart[] = [
    { id: 'body', shape: 'box', position: { x: 0, y: h / 2, z: 0 }, size: { width: w, height: h, depth: d }, color: COLORS.body },
    { id: 'slot1', shape: 'box', position: { x: -w * 0.18, y: h, z: -d * 0.15 }, size: { width: 0.12, height: 0.01, depth: 0.18 }, color: COLORS.slot },
    { id: 'slot2', shape: 'box', position: { x: w * 0.18, y: h, z: -d * 0.15 }, size: { width: 0.12, height: 0.01, depth: 0.18 }, color: COLORS.slot },
    { id: 'lever', shape: 'box', position: { x: w * 0.4, y: h * 0.55, z: 0 }, size: { width: 0.04, height: 0.06, depth: 0.08 }, color: COLORS.chrome },
  ];
  return { id: 'toaster', parts };
}

export function toasterParts(): PropPartSpec[] {
  return lowerPropRecipe(toasterRecipe());
}
