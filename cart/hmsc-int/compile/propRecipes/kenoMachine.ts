import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const kenoMachineDef: PropKindDefinition = {
  kind: 'kenoMachine',
  label: 'Keno Machine',
  solid: true,
  footprintRadiusMeters: 0.28,
  heightMeters: 1.1,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  cabinet: recipeColor('#1a1c1e'),
  dark: recipeColor('#0f1012'),
  screen: recipeColor('#111111'),
  bezel: recipeColor('#1a1c1e'),
  marquee: recipeColor('#212427'),
  control: recipeColor('#3a3f46'),
} satisfies Record<string, Color>;

export function kenoMachineRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'cabinet', shape: 'box', position: { x: 0, y: 0.550, z: 0 }, size: { width: 0.504, height: 1.100, depth: 0.280 }, color: COLORS.cabinet },
    { id: 'screen', shape: 'box', position: { x: 0, y: 0.682, z: -0.120 }, size: { width: 0.277, height: 0.275, depth: 0.015 }, color: COLORS.screen },
    { id: 'bezel', shape: 'box', position: { x: 0, y: 0.682, z: -0.130 }, size: { width: 0.328, height: 0.341, depth: 0.02 }, color: COLORS.bezel },
    { id: 'marquee', shape: 'box', position: { x: 0, y: 0.990, z: -0.120 }, size: { width: 0.302, height: 0.088, depth: 0.015 }, color: COLORS.marquee },
    { id: 'controlPanel', shape: 'box', position: { x: 0, y: 0.462, z: 0.190 }, size: { width: 0.504, height: 0.08, depth: 0.098 }, color: COLORS.dark },
    { id: 'joystick', shape: 'cylinder8', position: { x: -0.076, y: 0.528, z: 0.220 }, radius: 0.03, height: 0.08, color: COLORS.control },
    { id: 'buttonA', shape: 'cylinder8', position: { x: 0.060, y: 0.517, z: 0.220 }, radius: 0.025, height: 0.03, color: COLORS.control },
    { id: 'buttonB', shape: 'cylinder8', position: { x: 0.111, y: 0.517, z: 0.220 }, radius: 0.025, height: 0.03, color: COLORS.control },
  ];
  return { id: 'kenoMachine', parts };
}

export function kenoMachineParts(): PropPartSpec[] {
  return lowerPropRecipe(kenoMachineRecipe());
}
