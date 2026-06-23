import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const tvStandDef: PropKindDefinition = {
  kind: 'tvStand',
  label: 'TV Stand',
  solid: true,
  footprintRadiusMeters: 0.8,
  footprintDepthMeters: 0.55,
  heightMeters: 0.65,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'office', capacity: 2, spawnFillChance: 0.4, searchSeconds: 2, access: 'open' },
  coverClass: 'soft',
};

const COLORS = {
  body: recipeColor('#8a6240'),
  dark: recipeColor('#6b4a2e'),
  handle: recipeColor('#9aa1ab'),
} satisfies Record<string, Color>;

export function tvStandRecipe(): PropRecipe {
  const w = 1.6;
  const d = 0.55;
  const h = 0.65;
  const parts: PropRecipePart[] = [
    { id: 'body', shape: 'box', position: { x: 0, y: h / 2, z: 0 }, size: { width: w, height: h, depth: d }, color: COLORS.body },
    { id: 'top', shape: 'box', position: { x: 0, y: h, z: 0 }, size: { width: w * 1.02, height: 0.04, depth: d * 1.04 }, color: COLORS.dark },
    { id: 'shelf', shape: 'box', position: { x: 0, y: h * 0.35, z: 0 }, size: { width: w * 0.9, height: 0.03, depth: d * 0.85 }, color: COLORS.dark },
    { id: 'doorL', shape: 'box', position: { x: -w * 0.22, y: h * 0.2, z: -d / 2 - 0.005 }, size: { width: w * 0.38, height: h * 0.32, depth: 0.02 }, color: COLORS.dark },
    { id: 'doorR', shape: 'box', position: { x: w * 0.22, y: h * 0.2, z: -d / 2 - 0.005 }, size: { width: w * 0.38, height: h * 0.32, depth: 0.02 }, color: COLORS.dark },
  ];
  return { id: 'tvStand', parts };
}

export function tvStandParts(): PropPartSpec[] {
  return lowerPropRecipe(tvStandRecipe());
}
