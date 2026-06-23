import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const sandbagDef: PropKindDefinition = {
  kind: 'sandbag',
  label: 'Sandbag',
  solid: true,
  footprintRadiusMeters: 0.25,
  heightMeters: 0.25,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'soft',
};

const COLORS = {
  main: recipeColor('#c2a878'),
  rust: recipeColor('#746448'),
  dark: recipeColor('#4d4330'),
} satisfies Record<string, Color>;

export function sandbagRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'chunkA', shape: 'box', position: { x: -0.050, y: 0.087, z: 0.025 }, size: { width: 0.300, height: 0.125, depth: 0.225 }, color: COLORS.main, rotation: { pitch: 8, yaw: 12, roll: 0 } },
    { id: 'chunkB', shape: 'box', position: { x: 0.062, y: 0.138, z: -0.037 }, size: { width: 0.225, height: 0.100, depth: 0.275 }, color: COLORS.rust, rotation: { pitch: -5, yaw: -10, roll: 4 } },
    { id: 'chunkC', shape: 'box', position: { x: 0, y: 0.037, z: 0 }, size: { width: 0.350, height: 0.062, depth: 0.325 }, color: COLORS.dark },
  ];
  return { id: 'sandbag', parts };
}

export function sandbagParts(): PropPartSpec[] {
  return lowerPropRecipe(sandbagRecipe());
}
