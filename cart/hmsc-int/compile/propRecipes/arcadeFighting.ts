import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const arcadeFightingDef: PropKindDefinition = {
  kind: 'arcadeFighting',
  label: 'Fighting Arcade Machine',
  solid: true,
  footprintRadiusMeters: 0.35,
  heightMeters: 1.7,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  cabinet: recipeColor('#2d5a7d'),
  dark: recipeColor('#1b364a'),
  screen: recipeColor('#111111'),
  bezel: recipeColor('#1a1c1e'),
  marquee: recipeColor('#3a75a2'),
  control: recipeColor('#3a3f46'),
} satisfies Record<string, Color>;

export function arcadeFightingRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'cabinet', shape: 'box', position: { x: 0, y: 0.850, z: 0 }, size: { width: 0.630, height: 1.700, depth: 0.350 }, color: COLORS.cabinet },
    { id: 'screen', shape: 'box', position: { x: 0, y: 1.054, z: -0.155 }, size: { width: 0.347, height: 0.425, depth: 0.015 }, color: COLORS.screen },
    { id: 'bezel', shape: 'box', position: { x: 0, y: 1.054, z: -0.165 }, size: { width: 0.410, height: 0.527, depth: 0.02 }, color: COLORS.bezel },
    { id: 'marquee', shape: 'box', position: { x: 0, y: 1.530, z: -0.155 }, size: { width: 0.378, height: 0.136, depth: 0.015 }, color: COLORS.marquee },
    { id: 'controlPanel', shape: 'box', position: { x: 0, y: 0.714, z: 0.225 }, size: { width: 0.630, height: 0.08, depth: 0.122 }, color: COLORS.dark },
    { id: 'joystick', shape: 'cylinder8', position: { x: -0.095, y: 0.816, z: 0.255 }, radius: 0.03, height: 0.08, color: COLORS.control },
    { id: 'buttonA', shape: 'cylinder8', position: { x: 0.076, y: 0.799, z: 0.255 }, radius: 0.025, height: 0.03, color: COLORS.control },
    { id: 'buttonB', shape: 'cylinder8', position: { x: 0.139, y: 0.799, z: 0.255 }, radius: 0.025, height: 0.03, color: COLORS.control },
  ];
  return { id: 'arcadeFighting', parts };
}

export function arcadeFightingParts(): PropPartSpec[] {
  return lowerPropRecipe(arcadeFightingRecipe());
}
