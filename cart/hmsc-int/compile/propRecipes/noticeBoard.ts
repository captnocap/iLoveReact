import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const noticeBoardDef: PropKindDefinition = {
  kind: 'noticeBoard',
  label: 'Notice Board',
  solid: true,
  footprintRadiusMeters: 0.1,
  heightMeters: 1.4,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'none',
};

const COLORS = {
  frame: recipeColor('#6b4a2e'),
  board: recipeColor('#8a6240'),
  paper: recipeColor('#eef0f2'),
  pin: recipeColor('#c2362f'),
} satisfies Record<string, Color>;

export function noticeBoardRecipe(): PropRecipe {
  const h = 1.4;
  const parts: PropRecipePart[] = [
    {
      id: 'frame',
      shape: 'box',
      position: { x: 0, y: h * 0.5, z: 0 },
      size: { width: 1.1, height: h, depth: 0.05 },
      color: COLORS.frame,
    },
    {
      id: 'board',
      shape: 'box',
      position: { x: 0, y: h * 0.5, z: -0.02 },
      size: { width: 1.0, height: h * 0.9, depth: 0.03 },
      color: COLORS.board,
    },
    {
      id: 'paper1',
      shape: 'box',
      position: { x: -0.2, y: h * 0.65, z: -0.035 },
      size: { width: 0.25, height: 0.2, depth: 0.01 },
      color: COLORS.paper,
      rotation: { pitch: 0, yaw: 0, roll: -3 },
    },
    {
      id: 'pin1',
      shape: 'sphere',
      position: { x: -0.2, y: h * 0.75, z: -0.04 },
      size: { width: 0.02, height: 0.02, depth: 0.02 },
      color: COLORS.pin,
    },
    {
      id: 'paper2',
      shape: 'box',
      position: { x: 0.22, y: h * 0.45, z: -0.035 },
      size: { width: 0.28, height: 0.22, depth: 0.01 },
      color: COLORS.paper,
      rotation: { pitch: 0, yaw: 0, roll: 5 },
    },
    {
      id: 'pin2',
      shape: 'sphere',
      position: { x: 0.22, y: h * 0.55, z: -0.04 },
      size: { width: 0.02, height: 0.02, depth: 0.02 },
      color: COLORS.pin,
    },
  ];
  return { id: 'noticeBoard', parts };
}

export function noticeBoardParts(): PropPartSpec[] {
  return lowerPropRecipe(noticeBoardRecipe());
}
