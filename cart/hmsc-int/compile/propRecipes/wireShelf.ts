import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const wireShelfDef: PropKindDefinition = {
  kind: 'wireShelf',
  label: 'Wire Shelf',
  solid: true,
  footprintRadiusMeters: 0.4,
  heightMeters: 1.8,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  metal: recipeColor('#9aa1ab'),
  metalDark: recipeColor('#6c727b'),
} satisfies Record<string, Color>;

export function wireShelfRecipe(): PropRecipe {
  const h = 1.8;
  const w = 0.7;
  const d = 0.35;
  const parts: PropRecipePart[] = [
    {
      id: 'leftPost',
      shape: 'box',
      position: { x: -w * 0.5, y: h * 0.5, z: 0 },
      size: { width: 0.03, height: h, depth: d },
      color: COLORS.metal,
    },
    {
      id: 'rightPost',
      shape: 'box',
      position: { x: w * 0.5, y: h * 0.5, z: 0 },
      size: { width: 0.03, height: h, depth: d },
      color: COLORS.metal,
    },
    {
      id: 'shelf1',
      shape: 'box',
      position: { x: 0, y: h * 0.2, z: 0 },
      size: { width: w, height: 0.02, depth: d },
      color: COLORS.metalDark,
    },
    {
      id: 'shelf2',
      shape: 'box',
      position: { x: 0, y: h * 0.45, z: 0 },
      size: { width: w, height: 0.02, depth: d },
      color: COLORS.metalDark,
    },
    {
      id: 'shelf3',
      shape: 'box',
      position: { x: 0, y: h * 0.7, z: 0 },
      size: { width: w, height: 0.02, depth: d },
      color: COLORS.metalDark,
    },
    {
      id: 'shelf4',
      shape: 'box',
      position: { x: 0, y: h * 0.95, z: 0 },
      size: { width: w, height: 0.02, depth: d },
      color: COLORS.metalDark,
    },
  ];
  return { id: 'wireShelf', parts };
}

export function wireShelfParts(): PropPartSpec[] {
  return lowerPropRecipe(wireShelfRecipe());
}
