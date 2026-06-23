import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const grillCharcoalDef: PropKindDefinition = {
  kind: 'grillCharcoal',
  label: 'Charcoal Grill',
  solid: true,
  footprintRadiusMeters: 0.35,
  heightMeters: 0.85,
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

export function grillCharcoalRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'bowl', shape: 'cylinder16', position: { x: 0, y: 0.468, z: 0 }, radius: 0.350, height: 0.297, color: COLORS.body },
    { id: 'grate', shape: 'cylinder16', position: { x: 0, y: 0.612, z: 0 }, radius: 0.322, height: 0.020, color: COLORS.grate },
    { id: 'coal', shape: 'cylinder16', position: { x: 0, y: 0.493, z: 0 }, radius: 0.297, height: 0.040, color: COLORS.coal },
    { id: 'lid', shape: 'cylinder16', position: { x: 0, y: 0.663, z: 0 }, radius: 0.336, height: 0.060, color: COLORS.body },
    { id: 'legL', shape: 'box', position: { x: -0.175, y: 0.212, z: -0.175 }, size: { width: 0.03, height: 0.383, depth: 0.03 }, color: COLORS.leg },
    { id: 'legR', shape: 'box', position: { x: 0.175, y: 0.212, z: -0.175 }, size: { width: 0.03, height: 0.383, depth: 0.03 }, color: COLORS.leg },
    { id: 'legB', shape: 'box', position: { x: 0, y: 0.212, z: 0.175 }, size: { width: 0.03, height: 0.383, depth: 0.03 }, color: COLORS.leg },
    { id: 'wheelA', shape: 'cylinder8', position: { x: -0.175, y: 0.060, z: -0.175 }, radius: 0.06, height: 0.03, rotation: { pitch: 90, yaw: 0, roll: 0 }, color: COLORS.wheel },
    { id: 'wheelB', shape: 'cylinder8', position: { x: 0.175, y: 0.060, z: -0.175 }, radius: 0.06, height: 0.03, rotation: { pitch: 90, yaw: 0, roll: 0 }, color: COLORS.wheel },
  ];
  return { id: 'grillCharcoal', parts };
}

export function grillCharcoalParts(): PropPartSpec[] {
  return lowerPropRecipe(grillCharcoalRecipe());
}
