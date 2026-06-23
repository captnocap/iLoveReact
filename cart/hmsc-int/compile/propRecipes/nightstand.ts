import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const nightstandDef: PropKindDefinition = {
  kind: 'nightstand',
  label: 'Nightstand',
  solid: true,
  footprintRadiusMeters: 0.25,
  heightMeters: 0.55,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'valuables', capacity: 2, spawnFillChance: 0.4, searchSeconds: 2, access: 'open' },
};

const COLORS = {
  wood: recipeColor('#8a6240'),
  woodDark: recipeColor('#6b4a2e'),
  knob: recipeColor('#9aa1ab'),
} satisfies Record<string, Color>;

export function nightstandRecipe(): PropRecipe {
  const h = 0.55;
  const w = 0.45;
  const d = 0.4;
  const parts: PropRecipePart[] = [
    {
      id: 'body',
      shape: 'box',
      position: { x: 0, y: h * 0.5, z: 0 },
      size: { width: w, height: h * 0.95, depth: d },
      color: COLORS.wood,
    },
    {
      id: 'top',
      shape: 'box',
      position: { x: 0, y: h - 0.01, z: 0 },
      size: { width: w * 1.05, height: 0.03, depth: d * 1.05 },
      color: COLORS.woodDark,
    },
    {
      id: 'drawer',
      shape: 'box',
      position: { x: 0, y: h * 0.55, z: d * 0.5 },
      size: { width: w * 0.85, height: h * 0.35, depth: 0.03 },
      color: COLORS.woodDark,
    },
    {
      id: 'knob',
      shape: 'cylinder8',
      position: { x: 0, y: h * 0.55, z: d * 0.55 },
      radius: 0.015,
      height: 0.02,
      color: COLORS.knob,
    },
    {
      id: 'legFL',
      shape: 'box',
      position: { x: -w * 0.4, y: 0.08, z: d * 0.35 },
      size: { width: 0.04, height: 0.16, depth: 0.04 },
      color: COLORS.woodDark,
    },
    {
      id: 'legFR',
      shape: 'box',
      position: { x: w * 0.4, y: 0.08, z: d * 0.35 },
      size: { width: 0.04, height: 0.16, depth: 0.04 },
      color: COLORS.woodDark,
    },
  ];
  return { id: 'nightstand', parts };
}

export function nightstandParts(): PropPartSpec[] {
  return lowerPropRecipe(nightstandRecipe());
}
