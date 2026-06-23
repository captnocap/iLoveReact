import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const toiletStallDef: PropKindDefinition = {
  kind: 'toiletStall',
  label: 'Toilet Stall',
  solid: true,
  footprintRadiusMeters: 0.7,
  heightMeters: 1.9,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  wall: recipeColor('#9aa1ab'),
  door: recipeColor('#a9b1bc'),
  handle: recipeColor('#5c6066'),
} satisfies Record<string, Color>;

export function toiletStallRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'leftWall', shape: 'box', position: { x: -0.600, y: 0.950, z: 0 }, size: { width: 0.06, height: 1.900, depth: 1.260 }, color: COLORS.wall },
    { id: 'rightWall', shape: 'box', position: { x: 0.600, y: 0.950, z: 0 }, size: { width: 0.06, height: 1.900, depth: 1.260 }, color: COLORS.wall },
    { id: 'backWall', shape: 'box', position: { x: 0, y: 0.950, z: -0.600 }, size: { width: 1.260, height: 1.900, depth: 0.06 }, color: COLORS.wall },
    { id: 'door', shape: 'box', position: { x: 0.510, y: 0.950, z: 0.600 }, size: { width: 1.080, height: 1.800, depth: 0.04 }, color: COLORS.door },
    { id: 'handle', shape: 'box', position: { x: 0.315, y: 1.045, z: 0.650 }, size: { width: 0.04, height: 0.02, depth: 0.03 }, color: COLORS.handle },
  ];
  return { id: 'toiletStall', parts };
}

export function toiletStallParts(): PropPartSpec[] {
  return lowerPropRecipe(toiletStallRecipe());
}
