import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const wineRackDef: PropKindDefinition = {
  kind: 'wineRack',
  label: 'Wine Rack',
  solid: true,
  footprintRadiusMeters: 0.35,
  heightMeters: 1.6,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  wood: recipeColor('#6b4a2e'),
  woodDark: recipeColor('#4a3320'),
  bottle: recipeColor('#2d4a33'),
  foil: recipeColor('#8a4a32'),
} satisfies Record<string, Color>;

export function wineRackRecipe(): PropRecipe {
  const h = 1.6;
  const w = 0.6;
  const d = 0.3;
  const parts: PropRecipePart[] = [
    {
      id: 'frame',
      shape: 'box',
      position: { x: 0, y: h * 0.5, z: 0 },
      size: { width: w, height: h, depth: d },
      color: COLORS.wood,
    },
    {
      id: 'shelf1',
      shape: 'box',
      position: { x: 0, y: h * 0.25, z: 0 },
      size: { width: w * 0.9, height: 0.03, depth: d * 0.9 },
      color: COLORS.woodDark,
    },
    {
      id: 'shelf2',
      shape: 'box',
      position: { x: 0, y: h * 0.5, z: 0 },
      size: { width: w * 0.9, height: 0.03, depth: d * 0.9 },
      color: COLORS.woodDark,
    },
    {
      id: 'shelf3',
      shape: 'box',
      position: { x: 0, y: h * 0.75, z: 0 },
      size: { width: w * 0.9, height: 0.03, depth: d * 0.9 },
      color: COLORS.woodDark,
    },
    {
      id: 'bottle1',
      shape: 'cylinder16',
      position: { x: -w * 0.2, y: h * 0.15, z: 0 },
      radius: 0.035,
      height: 0.22,
      color: COLORS.bottle,
    },
    {
      id: 'bottle2',
      shape: 'cylinder16',
      position: { x: w * 0.2, y: h * 0.4, z: 0 },
      radius: 0.035,
      height: 0.22,
      color: COLORS.bottle,
    },
    {
      id: 'bottle3',
      shape: 'cylinder16',
      position: { x: 0, y: h * 0.65, z: 0 },
      radius: 0.035,
      height: 0.22,
      color: COLORS.bottle,
    },
  ];
  return { id: 'wineRack', parts };
}

export function wineRackParts(): PropPartSpec[] {
  return lowerPropRecipe(wineRackRecipe());
}
