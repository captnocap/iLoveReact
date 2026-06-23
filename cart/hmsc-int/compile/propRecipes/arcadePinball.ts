import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const arcadePinballDef: PropKindDefinition = {
  kind: 'arcadePinball',
  label: 'Pinball Machine',
  solid: true,
  footprintRadiusMeters: 0.35,
  heightMeters: 1.6,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  cabinet: recipeColor('#9c2a25'),
  dark: recipeColor('#5d1916'),
  screen: recipeColor('#111111'),
  bezel: recipeColor('#1a1c1e'),
  marquee: recipeColor('#ca3630'),
  control: recipeColor('#3a3f46'),
} satisfies Record<string, Color>;

export function arcadePinballRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'cabinet', shape: 'box', position: { x: 0, y: 0.800, z: 0 }, size: { width: 0.630, height: 1.600, depth: 0.350 }, color: COLORS.cabinet },
    { id: 'screen', shape: 'box', position: { x: 0, y: 0.992, z: -0.155 }, size: { width: 0.347, height: 0.400, depth: 0.015 }, color: COLORS.screen },
    { id: 'bezel', shape: 'box', position: { x: 0, y: 0.992, z: -0.165 }, size: { width: 0.410, height: 0.496, depth: 0.02 }, color: COLORS.bezel },
    { id: 'marquee', shape: 'box', position: { x: 0, y: 1.440, z: -0.155 }, size: { width: 0.378, height: 0.128, depth: 0.015 }, color: COLORS.marquee },
    { id: 'controlPanel', shape: 'box', position: { x: 0, y: 0.672, z: 0.225 }, size: { width: 0.630, height: 0.08, depth: 0.122 }, color: COLORS.dark },
    { id: 'joystick', shape: 'cylinder8', position: { x: -0.095, y: 0.768, z: 0.255 }, radius: 0.03, height: 0.08, color: COLORS.control },
    { id: 'buttonA', shape: 'cylinder8', position: { x: 0.076, y: 0.752, z: 0.255 }, radius: 0.025, height: 0.03, color: COLORS.control },
    { id: 'buttonB', shape: 'cylinder8', position: { x: 0.139, y: 0.752, z: 0.255 }, radius: 0.025, height: 0.03, color: COLORS.control },
  ];
  return { id: 'arcadePinball', parts };
}

export function arcadePinballParts(): PropPartSpec[] {
  return lowerPropRecipe(arcadePinballRecipe());
}
