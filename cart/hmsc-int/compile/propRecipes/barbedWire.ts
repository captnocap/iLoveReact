import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const barbedWireDef: PropKindDefinition = {
  kind: 'barbedWire',
  label: 'Barbed Wire',
  solid: true,
  footprintRadiusMeters: 0.5,
  heightMeters: 0.6,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  main: recipeColor('#6c727b'),
  rust: recipeColor('#404449'),
  dark: recipeColor('#2b2d31'),
} satisfies Record<string, Color>;

export function barbedWireRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'chunkA', shape: 'box', position: { x: -0.100, y: 0.210, z: 0.050 }, size: { width: 0.600, height: 0.300, depth: 0.450 }, color: COLORS.main, rotation: { pitch: 8, yaw: 12, roll: 0 } },
    { id: 'chunkB', shape: 'box', position: { x: 0.125, y: 0.330, z: -0.075 }, size: { width: 0.450, height: 0.240, depth: 0.550 }, color: COLORS.rust, rotation: { pitch: -5, yaw: -10, roll: 4 } },
    { id: 'chunkC', shape: 'box', position: { x: 0, y: 0.090, z: 0 }, size: { width: 0.700, height: 0.150, depth: 0.650 }, color: COLORS.dark },
  ];
  return { id: 'barbedWire', parts };
}

export function barbedWireParts(): PropPartSpec[] {
  return lowerPropRecipe(barbedWireRecipe());
}
