import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const scaffoldDef: PropKindDefinition = {
  kind: 'scaffold',
  label: 'Scaffold',
  solid: true,
  footprintRadiusMeters: 0.7,
  heightMeters: 2.5,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  main: recipeColor('#9aa1ab'),
  rust: recipeColor('#5c6066'),
  dark: recipeColor('#3d4044'),
} satisfies Record<string, Color>;

export function scaffoldRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'chunkA', shape: 'box', position: { x: -0.140, y: 0.875, z: 0.070 }, size: { width: 0.840, height: 1.250, depth: 0.630 }, color: COLORS.main, rotation: { pitch: 8, yaw: 12, roll: 0 } },
    { id: 'chunkB', shape: 'box', position: { x: 0.175, y: 1.375, z: -0.105 }, size: { width: 0.630, height: 1.000, depth: 0.770 }, color: COLORS.rust, rotation: { pitch: -5, yaw: -10, roll: 4 } },
    { id: 'chunkC', shape: 'box', position: { x: 0, y: 0.375, z: 0 }, size: { width: 0.980, height: 0.625, depth: 0.910 }, color: COLORS.dark },
  ];
  return { id: 'scaffold', parts };
}

export function scaffoldParts(): PropPartSpec[] {
  return lowerPropRecipe(scaffoldRecipe());
}
