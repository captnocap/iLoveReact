import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const roadSignOneWayDef: PropKindDefinition = {
  kind: 'roadSignOneWay',
  label: 'One Way Sign',
  solid: true,
  footprintRadiusMeters: 0.28,
  heightMeters: 1.5,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  post: recipeColor('#0f1012'),
  face: recipeColor('#1a1c1e'),
  trim: recipeColor('#141618'),
} satisfies Record<string, Color>;

export function roadSignOneWayRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'post', shape: 'box', position: { x: 0, y: 0.712, z: 0 }, size: { width: 0.060, height: 1.425, depth: 0.060 }, color: COLORS.post },
    { id: 'sign', shape: 'box', position: { x: 0, y: 1.687, z: 0 }, size: { width: 0.448, height: 0.525, depth: 0.050 }, color: COLORS.face },
    { id: 'trim', shape: 'box', position: { x: 0, y: 1.687, z: 0.027 }, size: { width: 0.408, height: 0.485, depth: 0.010 }, color: COLORS.trim },
  ];
  return { id: 'roadSignOneWay', parts };
}

export function roadSignOneWayParts(): PropPartSpec[] {
  return lowerPropRecipe(roadSignOneWayRecipe());
}
