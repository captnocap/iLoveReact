import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const toolCabinetDef: PropKindDefinition = {
  kind: 'toolCabinet',
  label: 'Tool Cabinet',
  solid: true,
  footprintRadiusMeters: 0.35,
  heightMeters: 1.2,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'tools', capacity: 5, spawnFillChance: 0.7, searchSeconds: 3, access: 'open' },
  coverClass: 'hard',
};

const COLORS = {
  body: recipeColor('#c2362f'),
  drawer: recipeColor('#9c2a25'),
  handle: recipeColor('#9aa1ab'),
} satisfies Record<string, Color>;

export function toolCabinetRecipe(): PropRecipe {
  const h = 1.2;
  const w = 0.6;
  const d = 0.35;
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'box',
      position: { x: 0, y: h * 0.5, z: 0 },
      size: { width: w, height: h * 0.95, depth: d },
      color: COLORS.body,
    },
    {
      id: 'drawer1',
      shape: 'box',
      position: { x: 0, y: h * 0.82, z: d * 0.5 },
      size: { width: w * 0.9, height: h * 0.16, depth: 0.03 },
      color: COLORS.drawer,
    },
    {
      id: 'drawer2',
      shape: 'box',
      position: { x: 0, y: h * 0.6, z: d * 0.5 },
      size: { width: w * 0.9, height: h * 0.16, depth: 0.03 },
      color: COLORS.drawer,
    },
    {
      id: 'drawer3',
      shape: 'box',
      position: { x: 0, y: h * 0.38, z: d * 0.5 },
      size: { width: w * 0.9, height: h * 0.16, depth: 0.03 },
      color: COLORS.drawer,
    },
    {
      id: 'handle1',
      shape: 'box',
      position: { x: 0, y: h * 0.82, z: d * 0.55 },
      size: { width: w * 0.3, height: 0.02, depth: 0.02 },
      color: COLORS.handle,
    },
    {
      id: 'handle2',
      shape: 'box',
      position: { x: 0, y: h * 0.6, z: d * 0.55 },
      size: { width: w * 0.3, height: 0.02, depth: 0.02 },
      color: COLORS.handle,
    },
    {
      id: 'handle3',
      shape: 'box',
      position: { x: 0, y: h * 0.38, z: d * 0.55 },
      size: { width: w * 0.3, height: 0.02, depth: 0.02 },
      color: COLORS.handle,
    },
  ];
  return { id: 'toolCabinet', parts };
}

export function toolCabinetParts(): PropPartSpec[] {
  return lowerPropRecipe(toolCabinetRecipe());
}
