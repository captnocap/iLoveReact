import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const wardrobeDef: PropKindDefinition = {
  kind: 'wardrobe',
  label: 'Wardrobe',
  solid: true,
  footprintRadiusMeters: 0.55,
  footprintDepthMeters: 0.7,
  heightMeters: 2.1,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'clothing', capacity: 5, spawnFillChance: 0.6, searchSeconds: 3, access: 'open' },
  coverClass: 'soft',
};

const COLORS = {
  wood: recipeColor('#8a6240'),
  dark: recipeColor('#6b4a2e'),
  handle: recipeColor('#9aa1ab'),
} satisfies Record<string, Color>;

export function wardrobeRecipe(): PropRecipe {
  const w = 1.1;
  const d = 0.7;
  const h = 2.1;
  const parts: PropRecipePart[] = [
    { id: 'leftDoor', shape: 'box', position: { x: -w / 4, y: h / 2, z: -d / 2 + 0.02 }, size: { width: w / 2, height: h * 0.92, depth: 0.04 }, color: COLORS.wood },
    { id: 'rightDoor', shape: 'box', position: { x: w / 4, y: h / 2, z: -d / 2 + 0.02 }, size: { width: w / 2, height: h * 0.92, depth: 0.04 }, color: COLORS.wood },
    { id: 'frame', shape: 'box', position: { x: 0, y: h / 2, z: 0 }, size: { width: w, height: h, depth: d }, color: COLORS.dark },
    { id: 'handleL', shape: 'box', position: { x: -w * 0.2, y: h * 0.5, z: -d / 2 - 0.02 }, size: { width: 0.03, height: 0.14, depth: 0.03 }, color: COLORS.handle },
    { id: 'handleR', shape: 'box', position: { x: w * 0.2, y: h * 0.5, z: -d / 2 - 0.02 }, size: { width: 0.03, height: 0.14, depth: 0.03 }, color: COLORS.handle },
  ];
  return { id: 'wardrobe', parts };
}

export function wardrobeParts(): PropPartSpec[] {
  return lowerPropRecipe(wardrobeRecipe());
}
