import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const arcadeRacingDef: PropKindDefinition = {
  kind: 'arcadeRacing',
  label: 'Racing Arcade Machine',
  solid: true,
  footprintRadiusMeters: 0.55,
  heightMeters: 1.5,
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

export function arcadeRacingRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'cabinet', shape: 'box', position: { x: 0, y: 0.750, z: 0 }, size: { width: 0.990, height: 1.500, depth: 0.550 }, color: COLORS.cabinet },
    { id: 'screen', shape: 'box', position: { x: 0, y: 0.930, z: -0.255 }, size: { width: 0.545, height: 0.375, depth: 0.015 }, color: COLORS.screen },
    { id: 'bezel', shape: 'box', position: { x: 0, y: 0.930, z: -0.265 }, size: { width: 0.644, height: 0.465, depth: 0.02 }, color: COLORS.bezel },
    { id: 'marquee', shape: 'box', position: { x: 0, y: 1.350, z: -0.255 }, size: { width: 0.594, height: 0.120, depth: 0.015 }, color: COLORS.marquee },
    { id: 'controlPanel', shape: 'box', position: { x: 0, y: 0.630, z: 0.325 }, size: { width: 0.990, height: 0.08, depth: 0.193 }, color: COLORS.dark },
    { id: 'joystick', shape: 'cylinder8', position: { x: -0.149, y: 0.720, z: 0.355 }, radius: 0.03, height: 0.08, color: COLORS.control },
    { id: 'buttonA', shape: 'cylinder8', position: { x: 0.119, y: 0.705, z: 0.355 }, radius: 0.025, height: 0.03, color: COLORS.control },
    { id: 'buttonB', shape: 'cylinder8', position: { x: 0.218, y: 0.705, z: 0.355 }, radius: 0.025, height: 0.03, color: COLORS.control },
  ];
  return { id: 'arcadeRacing', parts };
}

export function arcadeRacingParts(): PropPartSpec[] {
  return lowerPropRecipe(arcadeRacingRecipe());
}
