import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const grillGasDef: PropKindDefinition = {
  kind: 'grillGas',
  label: 'Gas Grill',
  solid: true,
  footprintRadiusMeters: 0.4,
  heightMeters: 1.0,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  body: recipeColor('#4a4a4e'),
  leg: recipeColor('#2c2c2e'),
  grate: recipeColor('#67676d'),
  coal: recipeColor('#3a3f46'),
  wheel: recipeColor('#1a1c1e'),
} satisfies Record<string, Color>;

export function grillGasRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'bowl', shape: 'cylinder16', position: { x: 0, y: 0.550, z: 0 }, radius: 0.400, height: 0.350, color: COLORS.body },
    { id: 'grate', shape: 'cylinder16', position: { x: 0, y: 0.720, z: 0 }, radius: 0.368, height: 0.020, color: COLORS.grate },
    { id: 'coal', shape: 'cylinder16', position: { x: 0, y: 0.580, z: 0 }, radius: 0.340, height: 0.040, color: COLORS.coal },
    { id: 'lid', shape: 'cylinder16', position: { x: 0, y: 0.780, z: 0 }, radius: 0.384, height: 0.060, color: COLORS.body },
    { id: 'legL', shape: 'box', position: { x: -0.200, y: 0.250, z: -0.200 }, size: { width: 0.03, height: 0.450, depth: 0.03 }, color: COLORS.leg },
    { id: 'legR', shape: 'box', position: { x: 0.200, y: 0.250, z: -0.200 }, size: { width: 0.03, height: 0.450, depth: 0.03 }, color: COLORS.leg },
    { id: 'legB', shape: 'box', position: { x: 0, y: 0.250, z: 0.200 }, size: { width: 0.03, height: 0.450, depth: 0.03 }, color: COLORS.leg },
    { id: 'wheelA', shape: 'cylinder8', position: { x: -0.200, y: 0.060, z: -0.200 }, radius: 0.06, height: 0.03, rotation: { pitch: 90, yaw: 0, roll: 0 }, color: COLORS.wheel },
    { id: 'wheelB', shape: 'cylinder8', position: { x: 0.200, y: 0.060, z: -0.200 }, radius: 0.06, height: 0.03, rotation: { pitch: 90, yaw: 0, roll: 0 }, color: COLORS.wheel },
  ];
  return { id: 'grillGas', parts };
}

export function grillGasParts(): PropPartSpec[] {
  return lowerPropRecipe(grillGasRecipe());
}
