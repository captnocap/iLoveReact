import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';

const COLORS = {
  shell: recipeColor('#cfc8b4'),
  shellDark: recipeColor('#b8b2a0'),
  shellLight: recipeColor('#d9d3c2'),
  shellTower: recipeColor('#c4bda9'),
  screen: recipeColor('#2c4a66'),
  black: recipeColor('#22262b'),
} satisfies Record<string, Color>;

export function computerRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'monitorShell',
      shape: 'box',
      position: { x: -0.05, y: 0.32, z: 0.06 },
      size: { width: 0.36, height: 0.3, depth: 0.3 },
      color: COLORS.shell,
    },
    {
      id: 'screen',
      shape: 'box',
      position: { x: -0.05, y: 0.32, z: -0.095 },
      size: { width: 0.3, height: 0.24, depth: 0.012 },
      color: COLORS.screen,
    },
    {
      id: 'monitorNeck',
      shape: 'box',
      position: { x: -0.05, y: 0.14, z: 0.06 },
      size: { width: 0.12, height: 0.06, depth: 0.12 },
      color: COLORS.shellDark,
    },
    {
      id: 'monitorBase',
      shape: 'box',
      position: { x: -0.05, y: 0.1, z: 0.06 },
      size: { width: 0.24, height: 0.025, depth: 0.2 },
      color: COLORS.shellDark,
    },
    {
      id: 'keyboard',
      shape: 'box',
      position: { x: -0.05, y: 0.105, z: -0.21 },
      size: { width: 0.34, height: 0.025, depth: 0.12 },
      color: COLORS.shellLight,
      rotation: { pitch: 4, yaw: 0, roll: 0 },
    },
    {
      id: 'tower',
      shape: 'box',
      position: { x: 0.24, y: 0.27, z: 0.02 },
      size: { width: 0.16, height: 0.42, depth: 0.38 },
      color: COLORS.shellTower,
    },
    {
      id: 'towerSlot',
      shape: 'box',
      position: { x: 0.24, y: 0.38, z: -0.175 },
      size: { width: 0.1, height: 0.03, depth: 0.012 },
      color: COLORS.black,
    },
  ];
  return { id: 'computer', parts };
}

export function computerParts(): PropPartSpec[] {
  return lowerPropRecipe(computerRecipe());
}
