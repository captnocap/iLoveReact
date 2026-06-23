import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const tvCRTDef: PropKindDefinition = {
  kind: 'tvCRT',
  label: 'CRT Television',
  solid: true,
  footprintRadiusMeters: 0.25,
  heightMeters: 0.48,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
  coverClass: 'none',
};

const COLORS = {
  shell: recipeColor('#3a3f46'),
  shellDark: recipeColor('#2d2f33'),
  screen: recipeColor('#1a1c1e'),
  glow: recipeColor('#2c4a66'),
} satisfies Record<string, Color>;

export function tvCRTRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'case',
      shape: 'box',
      position: { x: 0, y: 0.2, z: 0 },
      size: { width: 0.48, height: 0.4, depth: 0.42 },
      color: COLORS.shell,
    },
    {
      id: 'screen',
      shape: 'box',
      position: { x: 0, y: 0.22, z: -0.19 },
      size: { width: 0.4, height: 0.3, depth: 0.04 },
      color: COLORS.screen,
    },
    {
      id: 'screenGlow',
      shape: 'box',
      position: { x: 0, y: 0.22, z: -0.17 },
      size: { width: 0.34, height: 0.24, depth: 0.005 },
      color: COLORS.glow,
    },
    {
      id: 'bezel',
      shape: 'box',
      position: { x: 0, y: 0.22, z: -0.205 },
      size: { width: 0.46, height: 0.36, depth: 0.02 },
      color: COLORS.shellDark,
    },
    {
      id: 'controlPanel',
      shape: 'box',
      position: { x: 0, y: 0.08, z: -0.19 },
      size: { width: 0.3, height: 0.05, depth: 0.04 },
      color: COLORS.shellDark,
    },
    {
      id: 'knob1',
      shape: 'cylinder8',
      position: { x: -0.08, y: 0.08, z: -0.22 },
      radius: 0.02,
      height: 0.02,
      color: COLORS.glow,
    },
    {
      id: 'knob2',
      shape: 'cylinder8',
      position: { x: 0.08, y: 0.08, z: -0.22 },
      radius: 0.02,
      height: 0.02,
      color: COLORS.glow,
    },
    {
      id: 'antennaLeft',
      shape: 'cylinder8',
      position: { x: -0.12, y: 0.42, z: 0 },
      radius: 0.004,
      height: 0.25,
      color: COLORS.shellDark,
      rotation: { pitch: 0, yaw: 0, roll: -30 },
    },
    {
      id: 'antennaRight',
      shape: 'cylinder8',
      position: { x: 0.12, y: 0.42, z: 0 },
      radius: 0.004,
      height: 0.25,
      color: COLORS.shellDark,
      rotation: { pitch: 0, yaw: 0, roll: 30 },
    },
  ];
  return { id: 'tvCRT', parts };
}

export function tvCRTParts(): PropPartSpec[] {
  return lowerPropRecipe(tvCRTRecipe());
}
