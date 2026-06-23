import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const arcadeClawDef: PropKindDefinition = {
  kind: 'arcadeClaw',
  label: 'Claw Machine',
  solid: true,
  footprintRadiusMeters: 0.4,
  heightMeters: 1.9,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  cabinet: recipeColor('#e8b84a'),
  dark: recipeColor('#8b6e2c'),
  screen: recipeColor('#111111'),
  bezel: recipeColor('#1a1c1e'),
  marquee: recipeColor('#ffef60'),
  control: recipeColor('#3a3f46'),
} satisfies Record<string, Color>;

export function arcadeClawRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'cabinet', shape: 'box', position: { x: 0, y: 0.950, z: 0 }, size: { width: 0.720, height: 1.900, depth: 0.400 }, color: COLORS.cabinet },
    { id: 'screen', shape: 'box', position: { x: 0, y: 1.178, z: -0.180 }, size: { width: 0.396, height: 0.475, depth: 0.015 }, color: COLORS.screen },
    { id: 'bezel', shape: 'box', position: { x: 0, y: 1.178, z: -0.190 }, size: { width: 0.468, height: 0.589, depth: 0.02 }, color: COLORS.bezel },
    { id: 'marquee', shape: 'box', position: { x: 0, y: 1.710, z: -0.180 }, size: { width: 0.432, height: 0.152, depth: 0.015 }, color: COLORS.marquee },
    { id: 'controlPanel', shape: 'box', position: { x: 0, y: 0.798, z: 0.250 }, size: { width: 0.720, height: 0.08, depth: 0.140 }, color: COLORS.dark },
    { id: 'joystick', shape: 'cylinder8', position: { x: -0.108, y: 0.912, z: 0.280 }, radius: 0.03, height: 0.08, color: COLORS.control },
    { id: 'buttonA', shape: 'cylinder8', position: { x: 0.086, y: 0.893, z: 0.280 }, radius: 0.025, height: 0.03, color: COLORS.control },
    { id: 'buttonB', shape: 'cylinder8', position: { x: 0.158, y: 0.893, z: 0.280 }, radius: 0.025, height: 0.03, color: COLORS.control },
  ];
  return { id: 'arcadeClaw', parts };
}

export function arcadeClawParts(): PropPartSpec[] {
  return lowerPropRecipe(arcadeClawRecipe());
}
