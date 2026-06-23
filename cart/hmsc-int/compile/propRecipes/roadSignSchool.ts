import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const roadSignSchoolDef: PropKindDefinition = {
  kind: 'roadSignSchool',
  label: 'School Sign',
  solid: true,
  footprintRadiusMeters: 0.25,
  heightMeters: 1.8,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  post: recipeColor('#8b6e2c'),
  face: recipeColor('#e8b84a'),
  trim: recipeColor('#b9933b'),
} satisfies Record<string, Color>;

export function roadSignSchoolRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'post', shape: 'box', position: { x: 0, y: 0.855, z: 0 }, size: { width: 0.060, height: 1.710, depth: 0.060 }, color: COLORS.post },
    { id: 'sign', shape: 'box', position: { x: 0, y: 2.025, z: 0 }, size: { width: 0.400, height: 0.630, depth: 0.050 }, color: COLORS.face },
    { id: 'trim', shape: 'box', position: { x: 0, y: 2.025, z: 0.027 }, size: { width: 0.360, height: 0.590, depth: 0.010 }, color: COLORS.trim },
  ];
  return { id: 'roadSignSchool', parts };
}

export function roadSignSchoolParts(): PropPartSpec[] {
  return lowerPropRecipe(roadSignSchoolRecipe());
}
