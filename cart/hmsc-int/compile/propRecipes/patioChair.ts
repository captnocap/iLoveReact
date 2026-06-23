import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const patioChairDef: PropKindDefinition = {
  kind: 'patioChair',
  label: 'Patio Chair',
  solid: true,
  footprintRadiusMeters: 0.32,
  heightMeters: 0.9,
  tileKind: 'wall',
  trafficControl: 'none',
  seat: { pose: 'sit', seatHeightMeters: 0.45, capacity: 1 },
  coverClass: 'soft',
};

const COLORS = {
  frame: recipeColor('#6b4a2e'),
  sling: recipeColor('#3a7d80'),
} satisfies Record<string, Color>;

export function patioChairRecipe(): PropRecipe {
  const h = 0.9;
  const parts: PropRecipePart[] = [
    {
      id: 'seatFrame',
      shape: 'box',
      position: { x: 0, y: 0.45, z: 0 },
      size: { width: 0.6, height: 0.05, depth: 0.6 },
      color: COLORS.frame,
    },
    {
      id: 'sling',
      shape: 'box',
      position: { x: 0, y: 0.44, z: 0 },
      size: { width: 0.55, height: 0.03, depth: 0.55 },
      color: COLORS.sling,
    },
    {
      id: 'backFrame',
      shape: 'box',
      position: { x: 0, y: 0.7, z: -0.28 },
      size: { width: 0.6, height: 0.5, depth: 0.05 },
      color: COLORS.frame,
      rotation: { pitch: -15, yaw: 0, roll: 0 },
    },
    {
      id: 'backSling',
      shape: 'box',
      position: { x: 0, y: 0.7, z: -0.26 },
      size: { width: 0.55, height: 0.42, depth: 0.03 },
      color: COLORS.sling,
      rotation: { pitch: -15, yaw: 0, roll: 0 },
    },
    {
      id: 'legFL',
      shape: 'box',
      position: { x: -0.25, y: 0.22, z: 0.25 },
      size: { width: 0.04, height: 0.44, depth: 0.04 },
      color: COLORS.frame,
    },
    {
      id: 'legFR',
      shape: 'box',
      position: { x: 0.25, y: 0.22, z: 0.25 },
      size: { width: 0.04, height: 0.44, depth: 0.04 },
      color: COLORS.frame,
    },
    {
      id: 'legBL',
      shape: 'box',
      position: { x: -0.25, y: 0.22, z: -0.25 },
      size: { width: 0.04, height: 0.44, depth: 0.04 },
      color: COLORS.frame,
    },
    {
      id: 'legBR',
      shape: 'box',
      position: { x: 0.25, y: 0.22, z: -0.25 },
      size: { width: 0.04, height: 0.44, depth: 0.04 },
      color: COLORS.frame,
    },
  ];
  return { id: 'patioChair', parts };
}

export function patioChairParts(): PropPartSpec[] {
  return lowerPropRecipe(patioChairRecipe());
}
