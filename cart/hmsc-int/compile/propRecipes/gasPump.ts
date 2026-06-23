import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const gasPumpDef: PropKindDefinition = {
  kind: 'gasPump',
  label: 'Gas Pump',
  solid: true,
  footprintRadiusMeters: 0.42,
  heightMeters: 2.1,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'hard',
};

const COLORS = {
  body: recipeColor('#3a7d80'),
  panel: recipeColor('#eef0f2'),
  screen: recipeColor('#2c4a66'),
  hose: recipeColor('#1a1c1e'),
  nozzle: recipeColor('#9aa1ab'),
} satisfies Record<string, Color>;

export function gasPumpRecipe(): PropRecipe {
  const h = 2.1;
  const parts: PropRecipePart[] = [
    {
      id: 'base',
      shape: 'box',
      position: { x: 0, y: 0.04, z: 0 },
      size: { width: 0.7, height: 0.08, depth: 0.5 },
      color: COLORS.body,
    },
    {
      id: 'body',
      shape: 'box',
      position: { x: 0, y: h * 0.5, z: 0 },
      size: { width: 0.62, height: h * 0.92, depth: 0.42 },
      color: COLORS.body,
    },
    {
      id: 'panel',
      shape: 'box',
      position: { x: 0, y: h * 0.55, z: -0.2 },
      size: { width: 0.45, height: h * 0.35, depth: 0.04 },
      color: COLORS.panel,
    },
    {
      id: 'screen',
      shape: 'box',
      position: { x: 0, y: h * 0.65, z: -0.22 },
      size: { width: 0.25, height: 0.14, depth: 0.02 },
      color: COLORS.screen,
    },
    {
      id: 'hose',
      shape: 'cylinder8',
      position: { x: 0.32, y: h * 0.35, z: 0.1 },
      radius: 0.02,
      height: 0.8,
      color: COLORS.hose,
      rotation: { pitch: 0, yaw: 0, roll: 45 },
    },
    {
      id: 'nozzle',
      shape: 'box',
      position: { x: 0.38, y: h * 0.25, z: 0.18 },
      size: { width: 0.06, height: 0.04, depth: 0.18 },
      color: COLORS.nozzle,
    },
  ];
  return { id: 'gasPump', parts };
}

export function gasPumpParts(): PropPartSpec[] {
  return lowerPropRecipe(gasPumpRecipe());
}
