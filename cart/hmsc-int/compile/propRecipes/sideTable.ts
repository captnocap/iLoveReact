import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const sideTableDef: PropKindDefinition = {
  kind: 'sideTable',
  label: 'Side Table',
  solid: true,
  footprintRadiusMeters: 0.28,
  heightMeters: 0.62,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  wood: recipeColor('#8a6240'),
  woodDark: recipeColor('#6b4a2e'),
} satisfies Record<string, Color>;

export function sideTableRecipe(): PropRecipe {
  const h = 0.62;
  const parts: PropRecipePart[] = [
    {
      id: 'top',
      shape: 'box',
      position: { x: 0, y: h - 0.02, z: 0 },
      size: { width: 0.5, height: 0.04, depth: 0.5 },
      color: COLORS.wood,
    },
    {
      id: 'shelf',
      shape: 'box',
      position: { x: 0, y: h * 0.35, z: 0 },
      size: { width: 0.4, height: 0.03, depth: 0.4 },
      color: COLORS.woodDark,
    },
    {
      id: 'leg1',
      shape: 'box',
      position: { x: -0.2, y: h * 0.5, z: -0.2 },
      size: { width: 0.04, height: h, depth: 0.04 },
      color: COLORS.woodDark,
    },
    {
      id: 'leg2',
      shape: 'box',
      position: { x: 0.2, y: h * 0.5, z: -0.2 },
      size: { width: 0.04, height: h, depth: 0.04 },
      color: COLORS.woodDark,
    },
    {
      id: 'leg3',
      shape: 'box',
      position: { x: -0.2, y: h * 0.5, z: 0.2 },
      size: { width: 0.04, height: h, depth: 0.04 },
      color: COLORS.woodDark,
    },
    {
      id: 'leg4',
      shape: 'box',
      position: { x: 0.2, y: h * 0.5, z: 0.2 },
      size: { width: 0.04, height: h, depth: 0.04 },
      color: COLORS.woodDark,
    },
  ];
  return { id: 'sideTable', parts };
}

export function sideTableParts(): PropPartSpec[] {
  return lowerPropRecipe(sideTableRecipe());
}
