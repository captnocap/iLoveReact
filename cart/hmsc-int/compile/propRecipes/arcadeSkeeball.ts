import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const arcadeSkeeballDef: PropKindDefinition = {
  kind: 'arcadeSkeeball',
  label: 'Skeeball Machine',
  solid: true,
  footprintRadiusMeters: 0.65,
  heightMeters: 1.6,
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

export function arcadeSkeeballRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'cabinet', shape: 'box', position: { x: 0, y: 0.800, z: 0 }, size: { width: 1.170, height: 1.600, depth: 0.650 }, color: COLORS.cabinet },
    { id: 'screen', shape: 'box', position: { x: 0, y: 0.992, z: -0.305 }, size: { width: 0.644, height: 0.400, depth: 0.015 }, color: COLORS.screen },
    { id: 'bezel', shape: 'box', position: { x: 0, y: 0.992, z: -0.315 }, size: { width: 0.761, height: 0.496, depth: 0.02 }, color: COLORS.bezel },
    { id: 'marquee', shape: 'box', position: { x: 0, y: 1.440, z: -0.305 }, size: { width: 0.702, height: 0.128, depth: 0.015 }, color: COLORS.marquee },
    { id: 'controlPanel', shape: 'box', position: { x: 0, y: 0.672, z: 0.375 }, size: { width: 1.170, height: 0.08, depth: 0.227 }, color: COLORS.dark },
    { id: 'joystick', shape: 'cylinder8', position: { x: -0.176, y: 0.768, z: 0.405 }, radius: 0.03, height: 0.08, color: COLORS.control },
    { id: 'buttonA', shape: 'cylinder8', position: { x: 0.140, y: 0.752, z: 0.405 }, radius: 0.025, height: 0.03, color: COLORS.control },
    { id: 'buttonB', shape: 'cylinder8', position: { x: 0.257, y: 0.752, z: 0.405 }, radius: 0.025, height: 0.03, color: COLORS.control },
  ];
  return { id: 'arcadeSkeeball', parts };
}

export function arcadeSkeeballParts(): PropPartSpec[] {
  return lowerPropRecipe(arcadeSkeeballRecipe());
}
