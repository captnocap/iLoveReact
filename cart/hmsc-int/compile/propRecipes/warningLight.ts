import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const warningLightDef: PropKindDefinition = {
  kind: 'warningLight',
  label: 'Warning Light',
  solid: true,
  footprintRadiusMeters: 0.12,
  heightMeters: 0.65,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'none',
};

const COLORS = {
  main: recipeColor('#e8b84a'),
  rust: recipeColor('#8b6e2c'),
  dark: recipeColor('#5c491d'),
} satisfies Record<string, Color>;

export function warningLightRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'chunkA', shape: 'box', position: { x: -0.024, y: 0.227, z: 0.012 }, size: { width: 0.144, height: 0.325, depth: 0.108 }, color: COLORS.main, rotation: { pitch: 8, yaw: 12, roll: 0 } },
    { id: 'chunkB', shape: 'box', position: { x: 0.030, y: 0.358, z: -0.018 }, size: { width: 0.108, height: 0.260, depth: 0.132 }, color: COLORS.rust, rotation: { pitch: -5, yaw: -10, roll: 4 } },
    { id: 'chunkC', shape: 'box', position: { x: 0, y: 0.098, z: 0 }, size: { width: 0.168, height: 0.163, depth: 0.156 }, color: COLORS.dark },
  ];
  return { id: 'warningLight', parts };
}

export function warningLightParts(): PropPartSpec[] {
  return lowerPropRecipe(warningLightRecipe());
}
