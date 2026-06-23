import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const satelliteDishDef: PropKindDefinition = {
  kind: 'satelliteDish',
  label: 'Satellite Dish',
  solid: true,
  footprintRadiusMeters: 0.5,
  heightMeters: 1.0,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  main: recipeColor('#9aa1ab'),
  rust: recipeColor('#5c6066'),
  dark: recipeColor('#3d4044'),
} satisfies Record<string, Color>;

export function satelliteDishRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'chunkA', shape: 'box', position: { x: -0.100, y: 0.350, z: 0.050 }, size: { width: 0.600, height: 0.500, depth: 0.450 }, color: COLORS.main, rotation: { pitch: 8, yaw: 12, roll: 0 } },
    { id: 'chunkB', shape: 'box', position: { x: 0.125, y: 0.550, z: -0.075 }, size: { width: 0.450, height: 0.400, depth: 0.550 }, color: COLORS.rust, rotation: { pitch: -5, yaw: -10, roll: 4 } },
    { id: 'chunkC', shape: 'box', position: { x: 0, y: 0.150, z: 0 }, size: { width: 0.700, height: 0.250, depth: 0.650 }, color: COLORS.dark },
  ];
  return { id: 'satelliteDish', parts };
}

export function satelliteDishParts(): PropPartSpec[] {
  return lowerPropRecipe(satelliteDishRecipe());
}
