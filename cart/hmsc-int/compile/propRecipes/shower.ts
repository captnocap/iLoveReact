import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const showerDef: PropKindDefinition = {
  kind: 'shower',
  label: 'Shower Stall',
  solid: true,
  footprintRadiusMeters: 0.65,
  heightMeters: 2.2,
  tileKind: 'wall',
  trafficControl: 'none',
  coverClass: 'soft',
};

const COLORS = {
  tile: recipeColor('#d6d9dc'),
  grout: recipeColor('#aab0b6'),
  fixture: recipeColor('#9aa1ab'),
  glass: recipeColor('#bcd3dd'),
} satisfies Record<string, Color>;

export function showerRecipe(): PropRecipe {
  const r = 0.65;
  const h = 2.2;
  const parts: PropRecipePart[] = [
    { id: 'base', shape: 'box', position: { x: 0, y: 0.04, z: 0 }, size: { width: r * 2, height: 0.08, depth: r * 2 }, color: COLORS.tile },
    { id: 'backWall', shape: 'box', position: { x: 0, y: h / 2, z: r - 0.02 }, size: { width: r * 2, height: h, depth: 0.04 }, color: COLORS.tile },
    { id: 'leftWall', shape: 'box', position: { x: -r + 0.02, y: h / 2, z: 0 }, size: { width: 0.04, height: h, depth: r * 2 }, color: COLORS.tile },
    { id: 'rightWall', shape: 'box', position: { x: r - 0.02, y: h / 2, z: 0 }, size: { width: 0.04, height: h, depth: r * 2 }, color: COLORS.tile },
    { id: 'door', shape: 'box', position: { x: 0, y: h / 2, z: -r + 0.02 }, size: { width: r * 1.7, height: h, depth: 0.03 }, color: COLORS.glass, opacity: 0.25 },
    { id: 'head', shape: 'box', position: { x: 0, y: h * 0.9, z: r * 0.4 }, size: { width: 0.16, height: 0.04, depth: 0.08 }, color: COLORS.fixture },
    { id: 'pipe', shape: 'box', position: { x: 0, y: h * 0.82, z: r * 0.44 }, size: { width: 0.03, height: 0.16, depth: 0.03 }, color: COLORS.fixture },
  ];
  return { id: 'shower', parts };
}

export function showerParts(): PropPartSpec[] {
  return lowerPropRecipe(showerRecipe());
}
