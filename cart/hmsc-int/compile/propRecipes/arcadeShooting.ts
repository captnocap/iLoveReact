import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const arcadeShootingDef: PropKindDefinition = {
  kind: 'arcadeShooting',
  label: 'Shooting Arcade Machine',
  solid: true,
  footprintRadiusMeters: 0.4,
  heightMeters: 1.8,
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

export function arcadeShootingRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'cabinet', shape: 'box', position: { x: 0, y: 0.900, z: 0 }, size: { width: 0.720, height: 1.800, depth: 0.400 }, color: COLORS.cabinet },
    { id: 'screen', shape: 'box', position: { x: 0, y: 1.116, z: -0.180 }, size: { width: 0.396, height: 0.450, depth: 0.015 }, color: COLORS.screen },
    { id: 'bezel', shape: 'box', position: { x: 0, y: 1.116, z: -0.190 }, size: { width: 0.468, height: 0.558, depth: 0.02 }, color: COLORS.bezel },
    { id: 'marquee', shape: 'box', position: { x: 0, y: 1.620, z: -0.180 }, size: { width: 0.432, height: 0.144, depth: 0.015 }, color: COLORS.marquee },
    { id: 'controlPanel', shape: 'box', position: { x: 0, y: 0.756, z: 0.250 }, size: { width: 0.720, height: 0.08, depth: 0.140 }, color: COLORS.dark },
    { id: 'joystick', shape: 'cylinder8', position: { x: -0.108, y: 0.864, z: 0.280 }, radius: 0.03, height: 0.08, color: COLORS.control },
    { id: 'buttonA', shape: 'cylinder8', position: { x: 0.086, y: 0.846, z: 0.280 }, radius: 0.025, height: 0.03, color: COLORS.control },
    { id: 'buttonB', shape: 'cylinder8', position: { x: 0.158, y: 0.846, z: 0.280 }, radius: 0.025, height: 0.03, color: COLORS.control },
  ];
  return { id: 'arcadeShooting', parts };
}

export function arcadeShootingParts(): PropPartSpec[] {
  return lowerPropRecipe(arcadeShootingRecipe());
}
