import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const pachinkoMachineDef: PropKindDefinition = {
  kind: 'pachinkoMachine',
  label: 'Pachinko Machine',
  solid: true,
  footprintRadiusMeters: 0.3,
  heightMeters: 1.3,
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

export function pachinkoMachineRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'cabinet', shape: 'box', position: { x: 0, y: 0.650, z: 0 }, size: { width: 0.540, height: 1.300, depth: 0.300 }, color: COLORS.cabinet },
    { id: 'screen', shape: 'box', position: { x: 0, y: 0.806, z: -0.130 }, size: { width: 0.297, height: 0.325, depth: 0.015 }, color: COLORS.screen },
    { id: 'bezel', shape: 'box', position: { x: 0, y: 0.806, z: -0.140 }, size: { width: 0.351, height: 0.403, depth: 0.02 }, color: COLORS.bezel },
    { id: 'marquee', shape: 'box', position: { x: 0, y: 1.170, z: -0.130 }, size: { width: 0.324, height: 0.104, depth: 0.015 }, color: COLORS.marquee },
    { id: 'controlPanel', shape: 'box', position: { x: 0, y: 0.546, z: 0.200 }, size: { width: 0.540, height: 0.08, depth: 0.105 }, color: COLORS.dark },
    { id: 'joystick', shape: 'cylinder8', position: { x: -0.081, y: 0.624, z: 0.230 }, radius: 0.03, height: 0.08, color: COLORS.control },
    { id: 'buttonA', shape: 'cylinder8', position: { x: 0.065, y: 0.611, z: 0.230 }, radius: 0.025, height: 0.03, color: COLORS.control },
    { id: 'buttonB', shape: 'cylinder8', position: { x: 0.119, y: 0.611, z: 0.230 }, radius: 0.025, height: 0.03, color: COLORS.control },
  ];
  return { id: 'pachinkoMachine', parts };
}

export function pachinkoMachineParts(): PropPartSpec[] {
  return lowerPropRecipe(pachinkoMachineRecipe());
}
