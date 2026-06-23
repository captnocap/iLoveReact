import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const toiletPortableDef: PropKindDefinition = {
  kind: 'toiletPortable',
  label: 'Portable Toilet',
  solid: true,
  footprintRadiusMeters: 0.6,
  heightMeters: 2.1,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  top: recipeColor('#2d5a7d'),
  leg: recipeColor('#1d3a51'),
} satisfies Record<string, Color>;

export function toiletPortableRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'top', shape: 'box', position: { x: 0, y: 2.080, z: 0 }, size: { width: 1.080, height: 0.04, depth: 0.720 }, color: COLORS.top },
    { id: 'legFL', shape: 'box', position: { x: -0.510, y: 1.050, z: 0.330 }, size: { width: 0.04, height: 2.100, depth: 0.04 }, color: COLORS.leg },
    { id: 'legFR', shape: 'box', position: { x: 0.510, y: 1.050, z: 0.330 }, size: { width: 0.04, height: 2.100, depth: 0.04 }, color: COLORS.leg },
    { id: 'legBL', shape: 'box', position: { x: -0.510, y: 1.050, z: -0.330 }, size: { width: 0.04, height: 2.100, depth: 0.04 }, color: COLORS.leg },
    { id: 'legBR', shape: 'box', position: { x: 0.510, y: 1.050, z: -0.330 }, size: { width: 0.04, height: 2.100, depth: 0.04 }, color: COLORS.leg },
  ];
  return { id: 'toiletPortable', parts };
}

export function toiletPortableParts(): PropPartSpec[] {
  return lowerPropRecipe(toiletPortableRecipe());
}
