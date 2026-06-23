import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const businessSignDef: PropKindDefinition = {
  kind: 'businessSign',
  label: 'A-Frame Sign',
  solid: true,
  footprintRadiusMeters: 0.35,
  heightMeters: 1.1,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'none',
};

const COLORS = {
  frame: recipeColor('#6b4a2e'),
  board: recipeColor('#eef0f2'),
  text: recipeColor('#1a1c1e'),
} satisfies Record<string, Color>;

export function businessSignRecipe(): PropRecipe {
  const h = 1.1;
  const parts: PropRecipePart[] = [
    {
      id: 'leftLeg',
      shape: 'box',
      position: { x: -0.22, y: h * 0.45, z: 0 },
      size: { width: 0.05, height: h * 0.9, depth: 0.3 },
      color: COLORS.frame,
      rotation: { pitch: 0, yaw: 0, roll: -10 },
    },
    {
      id: 'rightLeg',
      shape: 'box',
      position: { x: 0.22, y: h * 0.45, z: 0 },
      size: { width: 0.05, height: h * 0.9, depth: 0.3 },
      color: COLORS.frame,
      rotation: { pitch: 0, yaw: 0, roll: 10 },
    },
    {
      id: 'board',
      shape: 'box',
      position: { x: 0, y: h * 0.55, z: -0.12 },
      size: { width: 0.45, height: h * 0.55, depth: 0.03 },
      color: COLORS.board,
    },
    {
      id: 'textLine1',
      shape: 'box',
      position: { x: 0, y: h * 0.65, z: -0.14 },
      size: { width: 0.3, height: 0.03, depth: 0.01 },
      color: COLORS.text,
    },
    {
      id: 'textLine2',
      shape: 'box',
      position: { x: 0, y: h * 0.55, z: -0.14 },
      size: { width: 0.25, height: 0.03, depth: 0.01 },
      color: COLORS.text,
    },
    {
      id: 'topBar',
      shape: 'box',
      position: { x: 0, y: h * 0.92, z: 0 },
      size: { width: 0.5, height: 0.05, depth: 0.32 },
      color: COLORS.frame,
    },
  ];
  return { id: 'businessSign', parts };
}

export function businessSignParts(): PropPartSpec[] {
  return lowerPropRecipe(businessSignRecipe());
}
