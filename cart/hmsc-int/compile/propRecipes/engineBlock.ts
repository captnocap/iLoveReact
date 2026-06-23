import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const engineBlockDef: PropKindDefinition = {
  kind: 'engineBlock',
  label: 'Engine Block',
  solid: true,
  footprintRadiusMeters: 0.35,
  heightMeters: 0.45,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'hard',
};

const COLORS = {
  main: recipeColor('#4a4a4e'),
  rust: recipeColor('#2c2c2e'),
  dark: recipeColor('#1d1d1f'),
} satisfies Record<string, Color>;

export function engineBlockRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'chunkA', shape: 'box', position: { x: -0.070, y: 0.158, z: 0.035 }, size: { width: 0.420, height: 0.225, depth: 0.315 }, color: COLORS.main, rotation: { pitch: 8, yaw: 12, roll: 0 } },
    { id: 'chunkB', shape: 'box', position: { x: 0.087, y: 0.248, z: -0.052 }, size: { width: 0.315, height: 0.180, depth: 0.385 }, color: COLORS.rust, rotation: { pitch: -5, yaw: -10, roll: 4 } },
    { id: 'chunkC', shape: 'box', position: { x: 0, y: 0.068, z: 0 }, size: { width: 0.490, height: 0.113, depth: 0.455 }, color: COLORS.dark },
  ];
  return { id: 'engineBlock', parts };
}

export function engineBlockParts(): PropPartSpec[] {
  return lowerPropRecipe(engineBlockRecipe());
}
