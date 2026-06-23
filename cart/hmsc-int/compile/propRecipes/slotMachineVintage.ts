import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const slotMachineVintageDef: PropKindDefinition = {
  kind: 'slotMachineVintage',
  label: 'Vintage Slot Machine',
  solid: true,
  footprintRadiusMeters: 0.32,
  heightMeters: 1.2,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  cabinet: recipeColor('#c2362f'),
  dark: recipeColor('#74201c'),
  screen: recipeColor('#111111'),
  bezel: recipeColor('#1a1c1e'),
  marquee: recipeColor('#fc463d'),
  control: recipeColor('#3a3f46'),
} satisfies Record<string, Color>;

export function slotMachineVintageRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'cabinet', shape: 'box', position: { x: 0, y: 0.600, z: 0 }, size: { width: 0.576, height: 1.200, depth: 0.320 }, color: COLORS.cabinet },
    { id: 'screen', shape: 'box', position: { x: 0, y: 0.744, z: -0.140 }, size: { width: 0.317, height: 0.300, depth: 0.015 }, color: COLORS.screen },
    { id: 'bezel', shape: 'box', position: { x: 0, y: 0.744, z: -0.150 }, size: { width: 0.374, height: 0.372, depth: 0.02 }, color: COLORS.bezel },
    { id: 'marquee', shape: 'box', position: { x: 0, y: 1.080, z: -0.140 }, size: { width: 0.346, height: 0.096, depth: 0.015 }, color: COLORS.marquee },
    { id: 'controlPanel', shape: 'box', position: { x: 0, y: 0.504, z: 0.210 }, size: { width: 0.576, height: 0.08, depth: 0.112 }, color: COLORS.dark },
    { id: 'joystick', shape: 'cylinder8', position: { x: -0.086, y: 0.576, z: 0.240 }, radius: 0.03, height: 0.08, color: COLORS.control },
    { id: 'buttonA', shape: 'cylinder8', position: { x: 0.069, y: 0.564, z: 0.240 }, radius: 0.025, height: 0.03, color: COLORS.control },
    { id: 'buttonB', shape: 'cylinder8', position: { x: 0.127, y: 0.564, z: 0.240 }, radius: 0.025, height: 0.03, color: COLORS.control },
  ];
  return { id: 'slotMachineVintage', parts };
}

export function slotMachineVintageParts(): PropPartSpec[] {
  return lowerPropRecipe(slotMachineVintageRecipe());
}
