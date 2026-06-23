import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const rustedBarrelDef: PropKindDefinition = {
  kind: 'rustedBarrel',
  label: 'Rusted Barrel',
  solid: true,
  footprintRadiusMeters: 0.28,
  heightMeters: 0.92,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'hard',
};

const COLORS = {
  main: recipeColor('#8a4a32'),
  rust: recipeColor('#522c1e'),
  dark: recipeColor('#371d14'),
} satisfies Record<string, Color>;

export function rustedBarrelRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'chunkA', shape: 'box', position: { x: -0.056, y: 0.322, z: 0.028 }, size: { width: 0.336, height: 0.460, depth: 0.252 }, color: COLORS.main, rotation: { pitch: 8, yaw: 12, roll: 0 } },
    { id: 'chunkB', shape: 'box', position: { x: 0.070, y: 0.506, z: -0.042 }, size: { width: 0.252, height: 0.368, depth: 0.308 }, color: COLORS.rust, rotation: { pitch: -5, yaw: -10, roll: 4 } },
    { id: 'chunkC', shape: 'box', position: { x: 0, y: 0.138, z: 0 }, size: { width: 0.392, height: 0.230, depth: 0.364 }, color: COLORS.dark },
  ];
  return { id: 'rustedBarrel', parts };
}

export function rustedBarrelParts(): PropPartSpec[] {
  return lowerPropRecipe(rustedBarrelRecipe());
}
