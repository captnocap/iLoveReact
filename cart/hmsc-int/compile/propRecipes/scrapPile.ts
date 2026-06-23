import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const scrapPileDef: PropKindDefinition = {
  kind: 'scrapPile',
  label: 'Scrap Pile',
  solid: true,
  footprintRadiusMeters: 1.1,
  heightMeters: 0.9,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'hard',
};

const COLORS = {
  main: recipeColor('#6c6d70'),
  rust: recipeColor('#404143'),
  dark: recipeColor('#2b2b2c'),
} satisfies Record<string, Color>;

export function scrapPileRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'chunkA', shape: 'box', position: { x: -0.220, y: 0.315, z: 0.110 }, size: { width: 1.320, height: 0.450, depth: 0.990 }, color: COLORS.main, rotation: { pitch: 8, yaw: 12, roll: 0 } },
    { id: 'chunkB', shape: 'box', position: { x: 0.275, y: 0.495, z: -0.165 }, size: { width: 0.990, height: 0.360, depth: 1.210 }, color: COLORS.rust, rotation: { pitch: -5, yaw: -10, roll: 4 } },
    { id: 'chunkC', shape: 'box', position: { x: 0, y: 0.135, z: 0 }, size: { width: 1.540, height: 0.225, depth: 1.430 }, color: COLORS.dark },
  ];
  return { id: 'scrapPile', parts };
}

export function scrapPileParts(): PropPartSpec[] {
  return lowerPropRecipe(scrapPileRecipe());
}
