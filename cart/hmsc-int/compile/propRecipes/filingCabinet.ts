import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const filingCabinetDef: PropKindDefinition = {
  kind: 'filingCabinet',
  label: 'Filing Cabinet',
  solid: true,
  footprintRadiusMeters: 0.28,
  footprintDepthMeters: 0.55,
  heightMeters: 1.3,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'office', capacity: 3, spawnFillChance: 0.5, searchSeconds: 2.5, access: 'locked' },
  coverClass: 'hard',
};

const COLORS = {
  body: recipeColor('#9aa1ab'),
  dark: recipeColor('#6c727b'),
  handle: recipeColor('#22262b'),
} satisfies Record<string, Color>;

export function filingCabinetRecipe(): PropRecipe {
  const w = 0.56;
  const d = 0.55;
  const h = 1.3;
  const parts: PropRecipePart[] = [
    { id: 'body', shape: 'box', position: { x: 0, y: h / 2, z: 0 }, size: { width: w, height: h, depth: d }, color: COLORS.body },
    { id: 'drawer1', shape: 'box', position: { x: 0, y: h * 0.2, z: -d / 2 - 0.005 }, size: { width: w * 0.85, height: h * 0.18, depth: 0.02 }, color: COLORS.dark },
    { id: 'drawer2', shape: 'box', position: { x: 0, y: h * 0.48, z: -d / 2 - 0.005 }, size: { width: w * 0.85, height: h * 0.18, depth: 0.02 }, color: COLORS.dark },
    { id: 'drawer3', shape: 'box', position: { x: 0, y: h * 0.76, z: -d / 2 - 0.005 }, size: { width: w * 0.85, height: h * 0.18, depth: 0.02 }, color: COLORS.dark },
    { id: 'handle1', shape: 'box', position: { x: 0, y: h * 0.2, z: -d / 2 - 0.015 }, size: { width: 0.08, height: 0.02, depth: 0.02 }, color: COLORS.handle },
    { id: 'handle2', shape: 'box', position: { x: 0, y: h * 0.48, z: -d / 2 - 0.015 }, size: { width: 0.08, height: 0.02, depth: 0.02 }, color: COLORS.handle },
    { id: 'handle3', shape: 'box', position: { x: 0, y: h * 0.76, z: -d / 2 - 0.015 }, size: { width: 0.08, height: 0.02, depth: 0.02 }, color: COLORS.handle },
  ];
  return { id: 'filingCabinet', parts };
}

export function filingCabinetParts(): PropPartSpec[] {
  return lowerPropRecipe(filingCabinetRecipe());
}
