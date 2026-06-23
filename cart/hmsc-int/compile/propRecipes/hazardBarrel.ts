import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const hazardBarrelDef: PropKindDefinition = {
  kind: 'hazardBarrel',
  label: 'Hazard Barrel',
  solid: true,
  footprintRadiusMeters: 0.3,
  heightMeters: 0.9,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'hard',
};

const COLORS = {
  main: recipeColor('#e8b84a'),
  rust: recipeColor('#8b6e2c'),
  dark: recipeColor('#5c491d'),
} satisfies Record<string, Color>;

export function hazardBarrelRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'chunkA', shape: 'box', position: { x: -0.060, y: 0.315, z: 0.030 }, size: { width: 0.360, height: 0.450, depth: 0.270 }, color: COLORS.main, rotation: { pitch: 8, yaw: 12, roll: 0 } },
    { id: 'chunkB', shape: 'box', position: { x: 0.075, y: 0.495, z: -0.045 }, size: { width: 0.270, height: 0.360, depth: 0.330 }, color: COLORS.rust, rotation: { pitch: -5, yaw: -10, roll: 4 } },
    { id: 'chunkC', shape: 'box', position: { x: 0, y: 0.135, z: 0 }, size: { width: 0.420, height: 0.225, depth: 0.390 }, color: COLORS.dark },
  ];
  return { id: 'hazardBarrel', parts };
}

export function hazardBarrelParts(): PropPartSpec[] {
  return lowerPropRecipe(hazardBarrelRecipe());
}
