import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const magazineRackDef: PropKindDefinition = {
  kind: 'magazineRack',
  label: 'Magazine Rack',
  solid: true,
  footprintRadiusMeters: 0.35,
  heightMeters: 0.9,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'office', capacity: 2, spawnFillChance: 0.6, searchSeconds: 1.5, access: 'open' },
  coverClass: 'soft',
};

const COLORS = {
  frame: recipeColor('#6b4a2e'),
  magazine: recipeColor('#3a7d80'),
} satisfies Record<string, Color>;

export function magazineRackRecipe(): PropRecipe {
  const w = 0.7;
  const d = 0.35;
  const h = 0.9;
  const parts: PropRecipePart[] = [
    { id: 'leftPost', shape: 'box', position: { x: -w / 2 + 0.02, y: h / 2, z: 0 }, size: { width: 0.04, height: h, depth: d }, color: COLORS.frame },
    { id: 'rightPost', shape: 'box', position: { x: w / 2 - 0.02, y: h / 2, z: 0 }, size: { width: 0.04, height: h, depth: d }, color: COLORS.frame },
    { id: 'bottom', shape: 'box', position: { x: 0, y: 0.04, z: 0 }, size: { width: w, height: 0.04, depth: d }, color: COLORS.frame },
    { id: 'magazines', shape: 'box', position: { x: 0, y: h * 0.4, z: 0 }, size: { width: w * 0.8, height: h * 0.35, depth: d * 0.65 }, color: COLORS.magazine },
  ];
  return { id: 'magazineRack', parts };
}

export function magazineRackParts(): PropPartSpec[] {
  return lowerPropRecipe(magazineRackRecipe());
}
