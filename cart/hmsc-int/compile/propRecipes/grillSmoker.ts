import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const grillSmokerDef: PropKindDefinition = {
  kind: 'grillSmoker',
  label: 'Smoker',
  solid: true,
  footprintRadiusMeters: 0.35,
  heightMeters: 1.1,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  body: recipeColor('#3a3f46'),
  leg: recipeColor('#22252a'),
  grate: recipeColor('#515862'),
  coal: recipeColor('#3a3f46'),
  wheel: recipeColor('#1a1c1e'),
} satisfies Record<string, Color>;

export function grillSmokerRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'bowl', shape: 'cylinder16', position: { x: 0, y: 0.605, z: 0 }, radius: 0.350, height: 0.385, color: COLORS.body },
    { id: 'grate', shape: 'cylinder16', position: { x: 0, y: 0.792, z: 0 }, radius: 0.322, height: 0.020, color: COLORS.grate },
    { id: 'coal', shape: 'cylinder16', position: { x: 0, y: 0.638, z: 0 }, radius: 0.297, height: 0.040, color: COLORS.coal },
    { id: 'lid', shape: 'cylinder16', position: { x: 0, y: 0.858, z: 0 }, radius: 0.336, height: 0.060, color: COLORS.body },
    { id: 'legL', shape: 'box', position: { x: -0.175, y: 0.275, z: -0.175 }, size: { width: 0.03, height: 0.495, depth: 0.03 }, color: COLORS.leg },
    { id: 'legR', shape: 'box', position: { x: 0.175, y: 0.275, z: -0.175 }, size: { width: 0.03, height: 0.495, depth: 0.03 }, color: COLORS.leg },
    { id: 'legB', shape: 'box', position: { x: 0, y: 0.275, z: 0.175 }, size: { width: 0.03, height: 0.495, depth: 0.03 }, color: COLORS.leg },
    { id: 'wheelA', shape: 'cylinder8', position: { x: -0.175, y: 0.060, z: -0.175 }, radius: 0.06, height: 0.03, rotation: { pitch: 90, yaw: 0, roll: 0 }, color: COLORS.wheel },
    { id: 'wheelB', shape: 'cylinder8', position: { x: 0.175, y: 0.060, z: -0.175 }, radius: 0.06, height: 0.03, rotation: { pitch: 90, yaw: 0, roll: 0 }, color: COLORS.wheel },
  ];
  return { id: 'grillSmoker', parts };
}

export function grillSmokerParts(): PropPartSpec[] {
  return lowerPropRecipe(grillSmokerRecipe());
}
