import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const consoleTableDef: PropKindDefinition = {
  kind: 'consoleTable',
  label: 'Console Table',
  solid: true,
  footprintRadiusMeters: 0.35,
  heightMeters: 0.82,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  wood: recipeColor('#8a6240'),
  woodDark: recipeColor('#6b4a2e'),
} satisfies Record<string, Color>;

export function consoleTableRecipe(): PropRecipe {
  const h = 0.82;
  const w = 1.2;
  const d = 0.35;
  const parts: PropRecipePart[] = [
    {
      id: 'top',
      shape: 'box',
      position: { x: 0, y: h - 0.02, z: 0 },
      size: { width: w, height: 0.04, depth: d },
      color: COLORS.wood,
    },
    {
      id: 'shelf',
      shape: 'box',
      position: { x: 0, y: h * 0.35, z: 0 },
      size: { width: w * 0.9, height: 0.03, depth: d * 0.8 },
      color: COLORS.woodDark,
    },
    {
      id: 'legL',
      shape: 'box',
      position: { x: -w * 0.45, y: h * 0.5, z: 0 },
      size: { width: 0.05, height: h, depth: d * 0.8 },
      color: COLORS.woodDark,
    },
    {
      id: 'legR',
      shape: 'box',
      position: { x: w * 0.45, y: h * 0.5, z: 0 },
      size: { width: 0.05, height: h, depth: d * 0.8 },
      color: COLORS.woodDark,
    },
  ];
  return { id: 'consoleTable', parts };
}

export function consoleTableParts(): PropPartSpec[] {
  return lowerPropRecipe(consoleTableRecipe());
}
