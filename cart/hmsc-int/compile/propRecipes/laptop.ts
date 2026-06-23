import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const laptopDef: PropKindDefinition = {
  kind: 'laptop',
  label: 'Laptop',
  solid: true,
  footprintRadiusMeters: 0.28,
  heightMeters: 0.18,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'surface',
  coverClass: 'none',
};

const COLORS = {
  shell: recipeColor('#b8b2a0'),
  screen: recipeColor('#2c4a66'),
  keys: recipeColor('#22262b'),
} satisfies Record<string, Color>;

export function laptopRecipe(): PropRecipe {
  const w = 0.56;
  const d = 0.38;
  const parts: PropRecipePart[] = [
    { id: 'base', shape: 'box', position: { x: 0, y: 0.015, z: 0 }, size: { width: w, height: 0.03, depth: d }, color: COLORS.shell },
    { id: 'keyboard', shape: 'box', position: { x: 0, y: 0.032, z: 0.04 }, size: { width: w * 0.85, height: 0.008, depth: d * 0.5 }, color: COLORS.keys },
    { id: 'screen', shape: 'box', position: { x: 0, y: 0.12, z: -d * 0.42 }, size: { width: w, height: 0.22, depth: 0.02 }, color: COLORS.shell, rotation: { pitch: -15, yaw: 0, roll: 0 } },
    { id: 'display', shape: 'box', position: { x: 0, y: 0.12, z: -d * 0.43 }, size: { width: w * 0.88, height: 0.18, depth: 0.01 }, color: COLORS.screen, rotation: { pitch: -15, yaw: 0, roll: 0 } },
  ];
  return { id: 'laptop', parts };
}

export function laptopParts(): PropPartSpec[] {
  return lowerPropRecipe(laptopRecipe());
}
