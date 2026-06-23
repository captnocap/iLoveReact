import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const radioTowerDef: PropKindDefinition = {
  kind: 'radioTower',
  label: 'Radio Tower',
  solid: true,
  footprintRadiusMeters: 2.2,
  heightMeters: 34,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  steel: recipeColor('#9aa1ab'),
  steelDark: recipeColor('#6c727b'),
  beacon: recipeColor('#ff3333'),
} satisfies Record<string, Color>;

export function radioTowerRecipe(): PropRecipe {
  const h = 34;
  const parts: PropRecipePart[] = [
    {
      id: 'legA',
      shape: 'box',
      position: { x: 1.4, y: h * 0.5, z: 1.4 },
      size: { width: 0.25, height: h, depth: 0.25 },
      color: COLORS.steel,
    },
    {
      id: 'legB',
      shape: 'box',
      position: { x: -1.4, y: h * 0.5, z: 1.4 },
      size: { width: 0.25, height: h, depth: 0.25 },
      color: COLORS.steel,
    },
    {
      id: 'legC',
      shape: 'box',
      position: { x: 1.4, y: h * 0.5, z: -1.4 },
      size: { width: 0.25, height: h, depth: 0.25 },
      color: COLORS.steel,
    },
    {
      id: 'legD',
      shape: 'box',
      position: { x: -1.4, y: h * 0.5, z: -1.4 },
      size: { width: 0.25, height: h, depth: 0.25 },
      color: COLORS.steel,
    },
    {
      id: 'brace1',
      shape: 'box',
      position: { x: 0, y: h * 0.2, z: 0 },
      size: { width: 2.6, height: 0.12, depth: 2.6 },
      color: COLORS.steelDark,
    },
    {
      id: 'brace2',
      shape: 'box',
      position: { x: 0, y: h * 0.5, z: 0 },
      size: { width: 1.8, height: 0.1, depth: 1.8 },
      color: COLORS.steelDark,
    },
    {
      id: 'brace3',
      shape: 'box',
      position: { x: 0, y: h * 0.75, z: 0 },
      size: { width: 1.0, height: 0.08, depth: 1.0 },
      color: COLORS.steelDark,
    },
    {
      id: 'mast',
      shape: 'cylinder16',
      position: { x: 0, y: h * 0.9, z: 0 },
      radius: 0.2,
      height: h * 0.2,
      color: COLORS.steel,
    },
    {
      id: 'beacon',
      shape: 'sphere',
      position: { x: 0, y: h, z: 0 },
      size: { width: 0.35, height: 0.35, depth: 0.35 },
      color: COLORS.beacon,
    },
  ];
  return { id: 'radioTower', parts };
}

export function radioTowerParts(): PropPartSpec[] {
  return lowerPropRecipe(radioTowerRecipe());
}
