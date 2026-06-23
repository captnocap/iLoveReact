import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const crushedCarDef: PropKindDefinition = {
  kind: 'crushedCar',
  label: 'Crushed Car',
  solid: true,
  footprintRadiusMeters: 1.3,
  heightMeters: 0.75,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'hard',
};

const COLORS = {
  main: recipeColor('#5c3328'),
  rust: recipeColor('#371e18'),
  dark: recipeColor('#241410'),
} satisfies Record<string, Color>;

export function crushedCarRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'chunkA', shape: 'box', position: { x: -0.260, y: 0.262, z: 0.130 }, size: { width: 1.560, height: 0.375, depth: 1.170 }, color: COLORS.main, rotation: { pitch: 8, yaw: 12, roll: 0 } },
    { id: 'chunkB', shape: 'box', position: { x: 0.325, y: 0.413, z: -0.195 }, size: { width: 1.170, height: 0.300, depth: 1.430 }, color: COLORS.rust, rotation: { pitch: -5, yaw: -10, roll: 4 } },
    { id: 'chunkC', shape: 'box', position: { x: 0, y: 0.112, z: 0 }, size: { width: 1.820, height: 0.188, depth: 1.690 }, color: COLORS.dark },
  ];
  return { id: 'crushedCar', parts };
}

export function crushedCarParts(): PropPartSpec[] {
  return lowerPropRecipe(crushedCarRecipe());
}
