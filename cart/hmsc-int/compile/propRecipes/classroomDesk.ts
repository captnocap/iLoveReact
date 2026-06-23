import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const classroomDeskDef: PropKindDefinition = {
  kind: 'classroomDesk',
  label: 'Classroom Desk',
  solid: true,
  footprintRadiusMeters: 0.45,
  heightMeters: 0.78,
  tileKind: 'wall',
  trafficControl: 'none',
  container: { lootCategory: 'office', capacity: 2, spawnFillChance: 0.4, searchSeconds: 2, access: 'open' },
};

const COLORS = {
  top: recipeColor('#8a6240'),
  leg: recipeColor('#6b4a2e'),
  metal: recipeColor('#9aa1ab'),
} satisfies Record<string, Color>;

export function classroomDeskRecipe(): PropRecipe {
  const h = 0.78;
  const w = 0.7;
  const d = 0.5;
  const parts: PropRecipePart[] = [
    {
      id: 'top',
      shape: 'box',
      position: { x: 0, y: h - 0.02, z: 0 },
      size: { width: w, height: 0.04, depth: d },
      color: COLORS.top,
    },
    {
      id: 'bookBox',
      shape: 'box',
      position: { x: 0, y: h * 0.55, z: 0.05 },
      size: { width: w * 0.85, height: 0.18, depth: d * 0.6 },
      color: COLORS.metal,
    },
    {
      id: 'frontLegL',
      shape: 'box',
      position: { x: -w * 0.4, y: h * 0.35, z: d * 0.35 },
      size: { width: 0.04, height: h * 0.7, depth: 0.04 },
      color: COLORS.leg,
    },
    {
      id: 'frontLegR',
      shape: 'box',
      position: { x: w * 0.4, y: h * 0.35, z: d * 0.35 },
      size: { width: 0.04, height: h * 0.7, depth: 0.04 },
      color: COLORS.leg,
    },
    {
      id: 'backLegL',
      shape: 'box',
      position: { x: -w * 0.4, y: h * 0.35, z: -d * 0.35 },
      size: { width: 0.04, height: h * 0.7, depth: 0.04 },
      color: COLORS.leg,
    },
    {
      id: 'backLegR',
      shape: 'box',
      position: { x: w * 0.4, y: h * 0.35, z: -d * 0.35 },
      size: { width: 0.04, height: h * 0.7, depth: 0.04 },
      color: COLORS.leg,
    },
  ];
  return { id: 'classroomDesk', parts };
}

export function classroomDeskParts(): PropPartSpec[] {
  return lowerPropRecipe(classroomDeskRecipe());
}
