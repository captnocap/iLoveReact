import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const arcadeAirHockeyDef: PropKindDefinition = {
  kind: 'arcadeAirHockey',
  label: 'Air Hockey Table',
  solid: true,
  footprintRadiusMeters: 0.7,
  heightMeters: 0.78,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  cabinet: recipeColor('#eef0f2'),
  dark: recipeColor('#8e9091'),
  screen: recipeColor('#111111'),
  bezel: recipeColor('#1a1c1e'),
  marquee: recipeColor('#ffffff'),
  control: recipeColor('#3a3f46'),
} satisfies Record<string, Color>;

export function arcadeAirHockeyRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'cabinet', shape: 'box', position: { x: 0, y: 0.390, z: 0 }, size: { width: 1.260, height: 0.780, depth: 0.700 }, color: COLORS.cabinet },
    { id: 'screen', shape: 'box', position: { x: 0, y: 0.484, z: -0.330 }, size: { width: 0.693, height: 0.195, depth: 0.015 }, color: COLORS.screen },
    { id: 'bezel', shape: 'box', position: { x: 0, y: 0.484, z: -0.340 }, size: { width: 0.819, height: 0.242, depth: 0.02 }, color: COLORS.bezel },
    { id: 'marquee', shape: 'box', position: { x: 0, y: 0.702, z: -0.330 }, size: { width: 0.756, height: 0.062, depth: 0.015 }, color: COLORS.marquee },
    { id: 'controlPanel', shape: 'box', position: { x: 0, y: 0.328, z: 0.400 }, size: { width: 1.260, height: 0.08, depth: 0.245 }, color: COLORS.dark },
    { id: 'joystick', shape: 'cylinder8', position: { x: -0.189, y: 0.374, z: 0.430 }, radius: 0.03, height: 0.08, color: COLORS.control },
    { id: 'buttonA', shape: 'cylinder8', position: { x: 0.151, y: 0.367, z: 0.430 }, radius: 0.025, height: 0.03, color: COLORS.control },
    { id: 'buttonB', shape: 'cylinder8', position: { x: 0.277, y: 0.367, z: 0.430 }, radius: 0.025, height: 0.03, color: COLORS.control },
  ];
  return { id: 'arcadeAirHockey', parts };
}

export function arcadeAirHockeyParts(): PropPartSpec[] {
  return lowerPropRecipe(arcadeAirHockeyRecipe());
}
