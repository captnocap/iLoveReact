import {
  lowerPropRecipe,
  recipeColor,
  type Color,
  type PropPartSpec,
  type PropRecipe,
  type PropRecipePart,
} from './types';
import { type PropKindDefinition } from '../../game/kinds/props';

export const writingDeskDef: PropKindDefinition = {
  kind: 'writingDesk',
  label: 'Writing Desk',
  solid: true,
  footprintRadiusMeters: 0.55,
  heightMeters: 0.78,
  tileKind: 'wall',
  trafficControl: 'none',
};

const COLORS = {
  top: recipeColor('#8a6240'),
  leg: recipeColor('#6b4a2e'),
  drawer: recipeColor('#6b4a2e'),
  knob: recipeColor('#9aa1ab'),
} satisfies Record<string, Color>;

export function writingDeskRecipe(): PropRecipe {
  const h = 0.78;
  const w = 1.0;
  const d = 0.55;
  const parts: PropRecipePart[] = [
    {
      id: 'top',
      shape: 'box',
      position: { x: 0, y: h - 0.02, z: 0 },
      size: { width: w, height: 0.04, depth: d },
      color: COLORS.top,
    },
    {
      id: 'drawerLeft',
      shape: 'box',
      position: { x: -w * 0.22, y: h * 0.82, z: d * 0.45 },
      size: { width: w * 0.4, height: h * 0.12, depth: 0.03 },
      color: COLORS.drawer,
    },
    {
      id: 'drawerRight',
      shape: 'box',
      position: { x: w * 0.22, y: h * 0.82, z: d * 0.45 },
      size: { width: w * 0.4, height: h * 0.12, depth: 0.03 },
      color: COLORS.drawer,
    },
    {
      id: 'knob1',
      shape: 'cylinder8',
      position: { x: -w * 0.22, y: h * 0.82, z: d * 0.5 },
      radius: 0.012,
      height: 0.02,
      color: COLORS.knob,
    },
    {
      id: 'knob2',
      shape: 'cylinder8',
      position: { x: w * 0.22, y: h * 0.82, z: d * 0.5 },
      radius: 0.012,
      height: 0.02,
      color: COLORS.knob,
    },
    {
      id: 'legFL',
      shape: 'box',
      position: { x: -w * 0.45, y: h * 0.45, z: d * 0.4 },
      size: { width: 0.05, height: h * 0.9, depth: 0.05 },
      color: COLORS.leg,
    },
    {
      id: 'legFR',
      shape: 'box',
      position: { x: w * 0.45, y: h * 0.45, z: d * 0.4 },
      size: { width: 0.05, height: h * 0.9, depth: 0.05 },
      color: COLORS.leg,
    },
    {
      id: 'legBL',
      shape: 'box',
      position: { x: -w * 0.45, y: h * 0.45, z: -d * 0.4 },
      size: { width: 0.05, height: h * 0.9, depth: 0.05 },
      color: COLORS.leg,
    },
    {
      id: 'legBR',
      shape: 'box',
      position: { x: w * 0.45, y: h * 0.45, z: -d * 0.4 },
      size: { width: 0.05, height: h * 0.9, depth: 0.05 },
      color: COLORS.leg,
    },
  ];
  return { id: 'writingDesk', parts };
}

export function writingDeskParts(): PropPartSpec[] {
  return lowerPropRecipe(writingDeskRecipe());
}
