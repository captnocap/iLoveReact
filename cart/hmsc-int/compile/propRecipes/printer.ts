import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const printerDef: PropKindDefinition = {
  kind: 'printer',
  label: 'Printer',
  solid: true,
  footprintRadiusMeters: 0.35,
  footprintDepthMeters: 0.5,
  heightMeters: 0.35,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
  coverClass: 'none',
};

const COLORS = {
  body: recipeColor('#d6d9dc'),
  dark: recipeColor('#aab0b6'),
  tray: recipeColor('#22262b'),
} satisfies Record<string, Color>;

export function printerRecipe(): PropRecipe {
  const w = 0.7;
  const d = 0.5;
  const h = 0.35;
  const parts: PropRecipePart[] = [
    { id: 'body', shape: 'box', position: { x: 0, y: h / 2, z: 0 }, size: { width: w, height: h, depth: d }, color: COLORS.body },
    { id: 'topLid', shape: 'box', position: { x: 0, y: h, z: 0 }, size: { width: w * 0.85, height: 0.03, depth: d * 0.8 }, color: COLORS.dark },
    { id: 'paperTray', shape: 'box', position: { x: 0, y: h * 0.35, z: d * 0.45 }, size: { width: w * 0.6, height: 0.08, depth: 0.04 }, color: COLORS.tray },
    { id: 'control', shape: 'box', position: { x: w * 0.32, y: h * 0.55, z: -d * 0.42 }, size: { width: 0.1, height: 0.08, depth: 0.02 }, color: COLORS.dark },
  ];
  return { id: 'printer', parts };
}

export function printerParts(): PropPartSpec[] {
  return lowerPropRecipe(printerRecipe());
}
