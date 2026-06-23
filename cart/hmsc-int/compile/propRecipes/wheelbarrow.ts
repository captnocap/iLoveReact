import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const wheelbarrowDef: PropKindDefinition = {
  kind: 'wheelbarrow',
  label: 'Wheelbarrow',
  solid: true,
  footprintRadiusMeters: 0.35,
  heightMeters: 0.55,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  main: recipeColor('#6b4a2e'),
  rust: recipeColor('#402c1b'),
  dark: recipeColor('#2a1d12'),
} satisfies Record<string, Color>;

export function wheelbarrowRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'chunkA', shape: 'box', position: { x: -0.070, y: 0.193, z: 0.035 }, size: { width: 0.420, height: 0.275, depth: 0.315 }, color: COLORS.main, rotation: { pitch: 8, yaw: 12, roll: 0 } },
    { id: 'chunkB', shape: 'box', position: { x: 0.087, y: 0.303, z: -0.052 }, size: { width: 0.315, height: 0.220, depth: 0.385 }, color: COLORS.rust, rotation: { pitch: -5, yaw: -10, roll: 4 } },
    { id: 'chunkC', shape: 'box', position: { x: 0, y: 0.083, z: 0 }, size: { width: 0.490, height: 0.138, depth: 0.455 }, color: COLORS.dark },
  ];
  return { id: 'wheelbarrow', parts };
}

export function wheelbarrowParts(): PropPartSpec[] {
  return lowerPropRecipe(wheelbarrowRecipe());
}
