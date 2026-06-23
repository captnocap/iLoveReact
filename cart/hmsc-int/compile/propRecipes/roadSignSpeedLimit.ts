import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const roadSignSpeedLimitDef: PropKindDefinition = {
  kind: 'roadSignSpeedLimit',
  label: 'Speed Limit Sign',
  solid: true,
  footprintRadiusMeters: 0.22,
  heightMeters: 1.8,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  post: recipeColor('#8e9091'),
  face: recipeColor('#eef0f2'),
  trim: recipeColor('#bec0c1'),
} satisfies Record<string, Color>;

export function roadSignSpeedLimitRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    { id: 'post', shape: 'box', position: { x: 0, y: 0.855, z: 0 }, size: { width: 0.060, height: 1.710, depth: 0.060 }, color: COLORS.post },
    { id: 'sign', shape: 'box', position: { x: 0, y: 2.025, z: 0 }, size: { width: 0.352, height: 0.630, depth: 0.050 }, color: COLORS.face },
    { id: 'trim', shape: 'box', position: { x: 0, y: 2.025, z: 0.027 }, size: { width: 0.312, height: 0.590, depth: 0.010 }, color: COLORS.trim },
  ];
  return { id: 'roadSignSpeedLimit', parts };
}

export function roadSignSpeedLimitParts(): PropPartSpec[] {
  return lowerPropRecipe(roadSignSpeedLimitRecipe());
}
