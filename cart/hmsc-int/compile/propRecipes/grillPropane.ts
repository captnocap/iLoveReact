import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const grillPropaneDef: PropKindDefinition = {
  kind: 'grillPropane',
  label: 'Propane Grill',
  solid: true,
  footprintRadiusMeters: 0.45,
  heightMeters: 1.1,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  body: recipeColor('#1a1c1e'),
  leg: recipeColor('#0f1012'),
  grate: recipeColor('#24272a'),
  coal: recipeColor('#3a3f46'),
  wheel: recipeColor('#1a1c1e'),
} satisfies Record<string, Color>;

export function grillPropaneRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'bowl', shape: 'cylinder16', position: { x: 0, y: 0.605, z: 0 }, radius: 0.450, height: 0.385, color: COLORS.body },
    { id: 'grate', shape: 'cylinder16', position: { x: 0, y: 0.792, z: 0 }, radius: 0.414, height: 0.020, color: COLORS.grate },
    { id: 'coal', shape: 'cylinder16', position: { x: 0, y: 0.638, z: 0 }, radius: 0.383, height: 0.040, color: COLORS.coal },
    { id: 'lid', shape: 'cylinder16', position: { x: 0, y: 0.858, z: 0 }, radius: 0.432, height: 0.060, color: COLORS.body },
    { id: 'legL', shape: 'box', position: { x: -0.225, y: 0.275, z: -0.225 }, size: { width: 0.03, height: 0.495, depth: 0.03 }, color: COLORS.leg },
    { id: 'legR', shape: 'box', position: { x: 0.225, y: 0.275, z: -0.225 }, size: { width: 0.03, height: 0.495, depth: 0.03 }, color: COLORS.leg },
    { id: 'legB', shape: 'box', position: { x: 0, y: 0.275, z: 0.225 }, size: { width: 0.03, height: 0.495, depth: 0.03 }, color: COLORS.leg },
    { id: 'wheelA', shape: 'cylinder8', position: { x: -0.225, y: 0.060, z: -0.225 }, radius: 0.06, height: 0.03, rotation: { pitch: 90, yaw: 0, roll: 0 }, color: COLORS.wheel },
    { id: 'wheelB', shape: 'cylinder8', position: { x: 0.225, y: 0.060, z: -0.225 }, radius: 0.06, height: 0.03, rotation: { pitch: 90, yaw: 0, roll: 0 }, color: COLORS.wheel },
  ];
  return { id: 'grillPropane', parts };
}

export function grillPropaneParts(): PropPartSpec[] {
  return lowerPropRecipe(grillPropaneRecipe());
}
