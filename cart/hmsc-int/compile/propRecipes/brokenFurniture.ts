import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const brokenFurnitureDef: PropKindDefinition = {
  kind: 'brokenFurniture',
  label: 'Broken Furniture',
  solid: true,
  footprintRadiusMeters: 0.6,
  heightMeters: 0.5,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'soft',
};

const COLORS = {
  main: recipeColor('#6b4a2e'),
  rust: recipeColor('#402c1b'),
  dark: recipeColor('#2a1d12'),
} satisfies Record<string, Color>;

export function brokenFurnitureRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'chunkA', shape: 'box', position: { x: -0.120, y: 0.175, z: 0.060 }, size: { width: 0.720, height: 0.250, depth: 0.540 }, color: COLORS.main, rotation: { pitch: 8, yaw: 12, roll: 0 } },
    { id: 'chunkB', shape: 'box', position: { x: 0.150, y: 0.275, z: -0.090 }, size: { width: 0.540, height: 0.200, depth: 0.660 }, color: COLORS.rust, rotation: { pitch: -5, yaw: -10, roll: 4 } },
    { id: 'chunkC', shape: 'box', position: { x: 0, y: 0.075, z: 0 }, size: { width: 0.840, height: 0.125, depth: 0.780 }, color: COLORS.dark },
  ];
  return { id: 'brokenFurniture', parts };
}

export function brokenFurnitureParts(): PropPartSpec[] {
  return lowerPropRecipe(brokenFurnitureRecipe());
}
