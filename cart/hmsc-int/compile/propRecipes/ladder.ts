import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const ladderDef: PropKindDefinition = {
  kind: 'ladder',
  label: 'Ladder',
  solid: true,
  footprintRadiusMeters: 0.2,
  heightMeters: 2.0,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  main: recipeColor('#9aa1ab'),
  rust: recipeColor('#5c6066'),
  dark: recipeColor('#3d4044'),
} satisfies Record<string, Color>;

export function ladderRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'chunkA', shape: 'box', position: { x: -0.040, y: 0.700, z: 0.020 }, size: { width: 0.240, height: 1.000, depth: 0.180 }, color: COLORS.main, rotation: { pitch: 8, yaw: 12, roll: 0 } },
    { id: 'chunkB', shape: 'box', position: { x: 0.050, y: 1.100, z: -0.030 }, size: { width: 0.180, height: 0.800, depth: 0.220 }, color: COLORS.rust, rotation: { pitch: -5, yaw: -10, roll: 4 } },
    { id: 'chunkC', shape: 'box', position: { x: 0, y: 0.300, z: 0 }, size: { width: 0.280, height: 0.500, depth: 0.260 }, color: COLORS.dark },
  ];
  return { id: 'ladder', parts };
}

export function ladderParts(): PropPartSpec[] {
  return lowerPropRecipe(ladderRecipe());
}
