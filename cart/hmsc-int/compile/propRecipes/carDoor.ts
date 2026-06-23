import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const carDoorDef: PropKindDefinition = {
  kind: 'carDoor',
  label: 'Car Door',
  solid: true,
  footprintRadiusMeters: 0.55,
  heightMeters: 1.15,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'hard',
};

const COLORS = {
  main: recipeColor('#7a3b2e'),
  rust: recipeColor('#49231b'),
  dark: recipeColor('#301712'),
} satisfies Record<string, Color>;

export function carDoorRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'chunkA', shape: 'box', position: { x: -0.110, y: 0.402, z: 0.055 }, size: { width: 0.660, height: 0.575, depth: 0.495 }, color: COLORS.main, rotation: { pitch: 8, yaw: 12, roll: 0 } },
    { id: 'chunkB', shape: 'box', position: { x: 0.138, y: 0.632, z: -0.083 }, size: { width: 0.495, height: 0.460, depth: 0.605 }, color: COLORS.rust, rotation: { pitch: -5, yaw: -10, roll: 4 } },
    { id: 'chunkC', shape: 'box', position: { x: 0, y: 0.172, z: 0 }, size: { width: 0.770, height: 0.287, depth: 0.715 }, color: COLORS.dark },
  ];
  return { id: 'carDoor', parts };
}

export function carDoorParts(): PropPartSpec[] {
  return lowerPropRecipe(carDoorRecipe());
}
