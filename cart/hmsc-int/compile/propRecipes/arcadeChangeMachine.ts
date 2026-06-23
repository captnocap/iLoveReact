import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const arcadeChangeMachineDef: PropKindDefinition = {
  kind: 'arcadeChangeMachine',
  label: 'Change Machine',
  solid: true,
  footprintRadiusMeters: 0.25,
  heightMeters: 1.4,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  cabinet: recipeColor('#4a4a4e'),
  dark: recipeColor('#2c2c2e'),
  screen: recipeColor('#111111'),
  bezel: recipeColor('#1a1c1e'),
  marquee: recipeColor('#606065'),
  control: recipeColor('#3a3f46'),
} satisfies Record<string, Color>;

export function arcadeChangeMachineRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'cabinet', shape: 'box', position: { x: 0, y: 0.700, z: 0 }, size: { width: 0.450, height: 1.400, depth: 0.250 }, color: COLORS.cabinet },
    { id: 'screen', shape: 'box', position: { x: 0, y: 0.868, z: -0.105 }, size: { width: 0.248, height: 0.350, depth: 0.015 }, color: COLORS.screen },
    { id: 'bezel', shape: 'box', position: { x: 0, y: 0.868, z: -0.115 }, size: { width: 0.293, height: 0.434, depth: 0.02 }, color: COLORS.bezel },
    { id: 'marquee', shape: 'box', position: { x: 0, y: 1.260, z: -0.105 }, size: { width: 0.270, height: 0.112, depth: 0.015 }, color: COLORS.marquee },
    { id: 'controlPanel', shape: 'box', position: { x: 0, y: 0.588, z: 0.175 }, size: { width: 0.450, height: 0.08, depth: 0.087 }, color: COLORS.dark },
    { id: 'joystick', shape: 'cylinder8', position: { x: -0.068, y: 0.672, z: 0.205 }, radius: 0.03, height: 0.08, color: COLORS.control },
    { id: 'buttonA', shape: 'cylinder8', position: { x: 0.054, y: 0.658, z: 0.205 }, radius: 0.025, height: 0.03, color: COLORS.control },
    { id: 'buttonB', shape: 'cylinder8', position: { x: 0.099, y: 0.658, z: 0.205 }, radius: 0.025, height: 0.03, color: COLORS.control },
  ];
  return { id: 'arcadeChangeMachine', parts };
}

export function arcadeChangeMachineParts(): PropPartSpec[] {
  return lowerPropRecipe(arcadeChangeMachineRecipe());
}
