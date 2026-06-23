import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const toolShelfDef: PropKindDefinition = {
  kind: 'toolShelf',
  label: 'Tool Shelf',
  solid: true,
  footprintRadiusMeters: 0.45,
  heightMeters: 2.0,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'tools', capacity: 5, spawnFillChance: 0.6, searchSeconds: 3, access: 'open' },
};

const COLORS = {
  metal: recipeColor('#9aa1ab'),
  metalDark: recipeColor('#6c727b'),
  box: recipeColor('#c2362f'),
} satisfies Record<string, Color>;

export function toolShelfRecipe(): PropRecipe {
  const h = 2.0;
  const w = 0.8;
  const d = 0.35;
  const parts: PropRecipePart[] = [
    {
      id: 'leftPost',
      shape: 'box',
      position: { x: -w * 0.5, y: h * 0.5, z: 0 },
      size: { width: 0.04, height: h, depth: d },
      color: COLORS.metal,
    },
    {
      id: 'rightPost',
      shape: 'box',
      position: { x: w * 0.5, y: h * 0.5, z: 0 },
      size: { width: 0.04, height: h, depth: d },
      color: COLORS.metal,
    },
    {
      id: 'shelf1',
      shape: 'box',
      position: { x: 0, y: h * 0.2, z: 0 },
      size: { width: w, height: 0.03, depth: d },
      color: COLORS.metalDark,
    },
    {
      id: 'shelf2',
      shape: 'box',
      position: { x: 0, y: h * 0.45, z: 0 },
      size: { width: w, height: 0.03, depth: d },
      color: COLORS.metalDark,
    },
    {
      id: 'shelf3',
      shape: 'box',
      position: { x: 0, y: h * 0.7, z: 0 },
      size: { width: w, height: 0.03, depth: d },
      color: COLORS.metalDark,
    },
    {
      id: 'shelf4',
      shape: 'box',
      position: { x: 0, y: h * 0.95, z: 0 },
      size: { width: w, height: 0.03, depth: d },
      color: COLORS.metalDark,
    },
    {
      id: 'toolbox',
      shape: 'box',
      position: { x: -w * 0.15, y: h * 0.26, z: 0 },
      size: { width: 0.25, height: 0.12, depth: 0.2 },
      color: COLORS.box,
    },
  ];
  return { id: 'toolShelf', parts };
}

export function toolShelfParts(): PropPartSpec[] {
  return lowerPropRecipe(toolShelfRecipe());
}
