import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const gameConsoleDef: PropKindDefinition = {
  kind: 'gameConsole',
  label: 'Game Console',
  solid: true,
  footprintRadiusMeters: 0.25,
  heightMeters: 0.08,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
  coverClass: 'none',
};

const COLORS = {
  body: recipeColor('#22262b'),
  vent: recipeColor('#4a4a4a'),
  led: recipeColor('#3a7d80'),
} satisfies Record<string, Color>;

export function gameConsoleRecipe(): PropRecipe {
  const w = 0.5;
  const d = 0.35;
  const h = 0.08;
  const parts: PropRecipePart[] = [
    { id: 'body', shape: 'box', position: { x: 0, y: h / 2, z: 0 }, size: { width: w, height: h, depth: d }, color: COLORS.body },
    { id: 'discSlot', shape: 'box', position: { x: w * 0.25, y: h, z: -d * 0.25 }, size: { width: 0.12, height: 0.01, depth: 0.04 }, color: COLORS.vent },
    { id: 'led', shape: 'box', position: { x: -w * 0.35, y: h, z: -d * 0.25 }, size: { width: 0.02, height: 0.01, depth: 0.02 }, color: COLORS.led },
  ];
  return { id: 'gameConsole', parts };
}

export function gameConsoleParts(): PropPartSpec[] {
  return lowerPropRecipe(gameConsoleRecipe());
}
