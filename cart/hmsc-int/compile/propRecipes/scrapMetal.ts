import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const scrapMetalDef: PropKindDefinition = {
  kind: 'scrapMetal',
  label: 'Scrap Metal',
  solid: true,
  footprintRadiusMeters: 0.7,
  heightMeters: 0.55,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'hard',
};

const COLORS = {
  main: recipeColor('#6c727b'),
  rust: recipeColor('#404449'),
  dark: recipeColor('#2b2d31'),
} satisfies Record<string, Color>;

export function scrapMetalRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'chunkA', shape: 'box', position: { x: -0.140, y: 0.193, z: 0.070 }, size: { width: 0.840, height: 0.275, depth: 0.630 }, color: COLORS.main, rotation: { pitch: 8, yaw: 12, roll: 0 } },
    { id: 'chunkB', shape: 'box', position: { x: 0.175, y: 0.303, z: -0.105 }, size: { width: 0.630, height: 0.220, depth: 0.770 }, color: COLORS.rust, rotation: { pitch: -5, yaw: -10, roll: 4 } },
    { id: 'chunkC', shape: 'box', position: { x: 0, y: 0.083, z: 0 }, size: { width: 0.980, height: 0.138, depth: 0.910 }, color: COLORS.dark },
  ];
  return { id: 'scrapMetal', parts };
}

export function scrapMetalParts(): PropPartSpec[] {
  return lowerPropRecipe(scrapMetalRecipe());
}
