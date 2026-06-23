import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const arcadeDanceDef: PropKindDefinition = {
  kind: 'arcadeDance',
  label: 'Dance Machine',
  solid: true,
  footprintRadiusMeters: 0.5,
  heightMeters: 0.15,
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

export function arcadeDanceRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'cabinet', shape: 'box', position: { x: 0, y: 0.075, z: 0 }, size: { width: 0.900, height: 0.150, depth: 0.500 }, color: COLORS.cabinet },
    { id: 'screen', shape: 'box', position: { x: 0, y: 0.093, z: -0.230 }, size: { width: 0.495, height: 0.037, depth: 0.015 }, color: COLORS.screen },
    { id: 'bezel', shape: 'box', position: { x: 0, y: 0.093, z: -0.240 }, size: { width: 0.585, height: 0.046, depth: 0.02 }, color: COLORS.bezel },
    { id: 'marquee', shape: 'box', position: { x: 0, y: 0.135, z: -0.230 }, size: { width: 0.540, height: 0.012, depth: 0.015 }, color: COLORS.marquee },
    { id: 'controlPanel', shape: 'box', position: { x: 0, y: 0.063, z: 0.300 }, size: { width: 0.900, height: 0.08, depth: 0.175 }, color: COLORS.dark },
    { id: 'joystick', shape: 'cylinder8', position: { x: -0.135, y: 0.072, z: 0.330 }, radius: 0.03, height: 0.08, color: COLORS.control },
    { id: 'buttonA', shape: 'cylinder8', position: { x: 0.108, y: 0.070, z: 0.330 }, radius: 0.025, height: 0.03, color: COLORS.control },
    { id: 'buttonB', shape: 'cylinder8', position: { x: 0.198, y: 0.070, z: 0.330 }, radius: 0.025, height: 0.03, color: COLORS.control },
  ];
  return { id: 'arcadeDance', parts };
}

export function arcadeDanceParts(): PropPartSpec[] {
  return lowerPropRecipe(arcadeDanceRecipe());
}
