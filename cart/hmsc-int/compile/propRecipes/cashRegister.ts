import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const cashRegisterDef: PropKindDefinition = {
  kind: 'cashRegister',
  label: 'Cash Register',
  solid: true,
  footprintRadiusMeters: 0.25,
  footprintDepthMeters: 0.45,
  heightMeters: 0.35,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
  container: { lootCategory: 'valuables', capacity: 2, spawnFillChance: 0.4, searchSeconds: 2, access: 'locked' },
  coverClass: 'none',
};

const COLORS = {
  body: recipeColor('#d6d9dc'),
  dark: recipeColor('#aab0b6'),
  screen: recipeColor('#2c4a66'),
  paper: recipeColor('#eef0f2'),
} satisfies Record<string, Color>;

export function cashRegisterRecipe(): PropRecipe {
  const w = 0.5;
  const d = 0.45;
  const h = 0.35;
  const parts: PropRecipePart[] = [
    { id: 'body', shape: 'box', position: { x: 0, y: h / 2, z: 0 }, size: { width: w, height: h, depth: d }, color: COLORS.body },
    { id: 'screen', shape: 'box', position: { x: 0, y: h * 0.75, z: -d * 0.35 }, size: { width: w * 0.5, height: h * 0.35, depth: 0.02 }, color: COLORS.screen, rotation: { pitch: -10, yaw: 0, roll: 0 } },
    { id: 'drawer', shape: 'box', position: { x: 0, y: h * 0.25, z: -d / 2 - 0.005 }, size: { width: w * 0.8, height: h * 0.35, depth: 0.02 }, color: COLORS.dark },
    { id: 'keypad', shape: 'box', position: { x: 0, y: h * 0.55, z: -d / 2 - 0.005 }, size: { width: w * 0.4, height: h * 0.2, depth: 0.015 }, color: COLORS.dark },
    { id: 'receipt', shape: 'box', position: { x: w * 0.25, y: h + 0.03, z: -d * 0.25 }, size: { width: 0.12, height: 0.06, depth: 0.02 }, color: COLORS.paper, rotation: { pitch: 20, yaw: 0, roll: -10 } },
    { id: 'coinTray', shape: 'box', position: { x: -w * 0.2, y: h * 0.32, z: -d / 2 - 0.008 }, size: { width: w * 0.25, height: h * 0.08, depth: 0.015 }, color: COLORS.dark },
  ];
  return { id: 'cashRegister', parts };
}

export function cashRegisterParts(): PropPartSpec[] {
  return lowerPropRecipe(cashRegisterRecipe());
}
