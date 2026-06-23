import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const whiteboardDef: PropKindDefinition = {
  kind: 'whiteboard',
  label: 'Whiteboard',
  solid: true,
  footprintRadiusMeters: 0.1,
  heightMeters: 1.2,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'none',
};

const COLORS = {
  frame: recipeColor('#9aa1ab'),
  board: recipeColor('#eef0f2'),
  marker: recipeColor('#3a7d80'),
  tray: recipeColor('#9aa1ab'),
} satisfies Record<string, Color>;

export function whiteboardRecipe(): PropRecipe {
  const h = 1.2;
  const parts: PropRecipePart[] = [
    {
      id: 'frame',
      shape: 'box',
      position: { x: 0, y: h * 0.5, z: 0 },
      size: { width: 1.6, height: h, depth: 0.04 },
      color: COLORS.frame,
    },
    {
      id: 'board',
      shape: 'box',
      position: { x: 0, y: h * 0.5, z: -0.02 },
      size: { width: 1.5, height: h * 0.9, depth: 0.02 },
      color: COLORS.board,
    },
    {
      id: 'line1',
      shape: 'box',
      position: { x: -0.2, y: h * 0.65, z: -0.03 },
      size: { width: 0.5, height: 0.015, depth: 0.005 },
      color: COLORS.marker,
    },
    {
      id: 'line2',
      shape: 'box',
      position: { x: 0.1, y: h * 0.45, z: -0.03 },
      size: { width: 0.4, height: 0.015, depth: 0.005 },
      color: COLORS.marker,
    },
    {
      id: 'tray',
      shape: 'box',
      position: { x: 0, y: h * 0.08, z: -0.03 },
      size: { width: 1.55, height: 0.03, depth: 0.05 },
      color: COLORS.tray,
    },
  ];
  return { id: 'whiteboard', parts };
}

export function whiteboardParts(): PropPartSpec[] {
  return lowerPropRecipe(whiteboardRecipe());
}
