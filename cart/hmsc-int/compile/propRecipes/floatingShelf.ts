import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const floatingShelfDef: PropKindDefinition = {
  kind: 'floatingShelf',
  label: 'Floating Shelf',
  solid: true,
  footprintRadiusMeters: 0.35,
  heightMeters: 0.08,
  tileKind: 'wall',
  trafficControl: 'none',
  mount: 'wall',
  coverClass: 'none',
};

const COLORS = {
  wood: recipeColor('#8a6240'),
  book: recipeColor('#3a7d80'),
  vase: recipeColor('#eef0f2'),
} satisfies Record<string, Color>;

export function floatingShelfRecipe(): PropRecipe {
  const parts: PropRecipePart[] = [
    {
      id: 'shelf',
      shape: 'box',
      position: { x: 0, y: 0.04, z: -0.05 },
      size: { width: 1.0, height: 0.08, depth: 0.2 },
      color: COLORS.wood,
    },
    {
      id: 'book1',
      shape: 'box',
      position: { x: -0.25, y: 0.12, z: -0.05 },
      size: { width: 0.04, height: 0.18, depth: 0.16 },
      color: COLORS.book,
    },
    {
      id: 'book2',
      shape: 'box',
      position: { x: -0.18, y: 0.12, z: -0.05 },
      size: { width: 0.04, height: 0.16, depth: 0.16 },
      color: COLORS.vase,
    },
    {
      id: 'vase',
      shape: 'cylinder16',
      position: { x: 0.25, y: 0.16, z: -0.05 },
      radius: 0.04,
      height: 0.12,
      color: COLORS.vase,
    },
  ];
  return { id: 'floatingShelf', parts };
}

export function floatingShelfParts(): PropPartSpec[] {
  return lowerPropRecipe(floatingShelfRecipe());
}
