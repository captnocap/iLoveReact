import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const dresserDef: PropKindDefinition = {
  kind: 'dresser',
  label: 'Dresser',
  solid: true,
  footprintRadiusMeters: 0.75,
  footprintDepthMeters: 0.55,
  heightMeters: 1.05,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'clothing', capacity: 4, spawnFillChance: 0.6, searchSeconds: 2.5, access: 'open' },
  coverClass: 'soft',
};

const COLORS = {
  body: recipeColor('#8a6240'),
  dark: recipeColor('#6b4a2e'),
  handle: recipeColor('#9aa1ab'),
} satisfies Record<string, Color>;

export function dresserRecipe(): PropRecipe {
  const w = 1.5;
  const d = 0.55;
  const h = 1.05;
  const parts: PropRecipePart[] = [
    { id: 'body', shape: 'box', position: { x: 0, y: h / 2, z: 0 }, size: { width: w, height: h, depth: d }, color: COLORS.body },
    { id: 'top', shape: 'box', position: { x: 0, y: h, z: 0 }, size: { width: w * 1.02, height: 0.04, depth: d * 1.04 }, color: COLORS.dark },
    { id: 'drawer1', shape: 'box', position: { x: -w * 0.22, y: h * 0.22, z: -d / 2 - 0.005 }, size: { width: w * 0.38, height: 0.18, depth: 0.02 }, color: COLORS.dark },
    { id: 'drawer2', shape: 'box', position: { x: w * 0.22, y: h * 0.22, z: -d / 2 - 0.005 }, size: { width: w * 0.38, height: 0.18, depth: 0.02 }, color: COLORS.dark },
    { id: 'drawer3', shape: 'box', position: { x: -w * 0.22, y: h * 0.52, z: -d / 2 - 0.005 }, size: { width: w * 0.38, height: 0.18, depth: 0.02 }, color: COLORS.dark },
    { id: 'drawer4', shape: 'box', position: { x: w * 0.22, y: h * 0.52, z: -d / 2 - 0.005 }, size: { width: w * 0.38, height: 0.18, depth: 0.02 }, color: COLORS.dark },
    { id: 'handle1', shape: 'box', position: { x: -w * 0.22, y: h * 0.22, z: -d / 2 - 0.015 }, size: { width: 0.06, height: 0.02, depth: 0.02 }, color: COLORS.handle },
    { id: 'handle2', shape: 'box', position: { x: w * 0.22, y: h * 0.22, z: -d / 2 - 0.015 }, size: { width: 0.06, height: 0.02, depth: 0.02 }, color: COLORS.handle },
  ];
  return { id: 'dresser', parts };
}

export function dresserParts(): PropPartSpec[] {
  return lowerPropRecipe(dresserRecipe());
}
